// SQL for media_assets / media_albums (migration 004, docs/PRODUCT_PLAN.md
// section 5E). Every query that touches an asset or album is scoped by
// vendor_id, so a vendor can never read or change another vendor's media.

import { pool } from "@/lib/db";
import { getStorage, isSafeKey } from "@/lib/storage";
import type { MediaKind, MediaPurpose } from "./config";

export type MediaStatus = "uploading" | "processing" | "pending_review" | "approved" | "rejected" | "hidden";

export interface VariantRef {
  key: string;
  w?: number;
  h?: number;
}

export interface MediaAssetRow {
  id: number;
  uuid: string;
  vendor_id: number;
  album_id: number | null;
  service_id: number | null;
  purpose: MediaPurpose;
  kind: MediaKind;
  storage_driver: string | null;
  storage_key: string | null;
  variants: Record<string, VariantRef>;
  external_url: string | null;
  external_provider: "youtube" | "instagram" | "vimeo" | null;
  external_id: string | null;
  poster_media_id: number | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  sha256: string | null;
  placeholder_color: string | null;
  caption: string;
  alt_text: string;
  status: MediaStatus;
  status_reason: string | null;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
}

export interface MediaAlbumRow {
  id: number;
  vendor_id: number;
  service_id: number | null;
  title: string;
  description: string;
  event_type_id: number | null;
  event_date: string | null;
  district_id: number | null;
  venue_name: string | null;
  cover_media_id: number | null;
  consent_confirmed_at: string | null;
  published: boolean;
  sort_order: number;
  created_at: string;
}

export interface VendorRef {
  id: number;
  status: string;
}

export async function findVendorRefByOwner(ownerId: number): Promise<VendorRef | null> {
  const r = await pool.query<VendorRef>(
    "SELECT id, status::text AS status FROM vendors WHERE owner_id = $1 ORDER BY id LIMIT 1",
    [ownerId]
  );
  return r.rows[0] ?? null;
}

/** New media from an approved vendor is public at once; otherwise it waits for review (4.5). */
export function initialStatusFor(vendor: VendorRef): MediaStatus {
  return vendor.status === "approved" ? "approved" : "pending_review";
}

export interface MediaUsage {
  images: number;
  videoLinks: number;
  videoFiles: number;
  albums: number;
}

/** Counts toward plan limits. Logo, cover and posters don't count; rejected items don't either. */
export async function getMediaUsage(vendorId: number): Promise<MediaUsage> {
  const r = await pool.query<{ images: string; video_links: string; video_files: string; albums: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE kind = 'image' AND purpose = 'gallery') AS images,
       COUNT(*) FILTER (WHERE kind = 'video_link') AS video_links,
       COUNT(*) FILTER (WHERE kind = 'video_file') AS video_files,
       (SELECT COUNT(*) FROM media_albums WHERE vendor_id = $1) AS albums
     FROM media_assets
     WHERE vendor_id = $1 AND status <> 'rejected'
       AND NOT (status = 'uploading' AND created_at < now() - interval '24 hours')`,
    [vendorId]
  );
  const row = r.rows[0];
  return {
    images: Number(row?.images ?? 0),
    videoLinks: Number(row?.video_links ?? 0),
    videoFiles: Number(row?.video_files ?? 0),
    albums: Number(row?.albums ?? 0),
  };
}

export async function findAsset(vendorId: number, id: number): Promise<MediaAssetRow | null> {
  const r = await pool.query<MediaAssetRow>(
    "SELECT * FROM media_assets WHERE id = $1 AND vendor_id = $2",
    [id, vendorId]
  );
  return r.rows[0] ?? null;
}

export async function findAssetBySha(vendorId: number, sha256: string): Promise<MediaAssetRow | null> {
  const r = await pool.query<MediaAssetRow>(
    "SELECT * FROM media_assets WHERE vendor_id = $1 AND sha256 = $2 LIMIT 1",
    [vendorId, sha256]
  );
  return r.rows[0] ?? null;
}

export async function findVideoLink(
  vendorId: number,
  provider: string,
  externalId: string
): Promise<MediaAssetRow | null> {
  const r = await pool.query<MediaAssetRow>(
    `SELECT * FROM media_assets
      WHERE vendor_id = $1 AND kind = 'video_link' AND external_provider = $2 AND external_id = $3
      LIMIT 1`,
    [vendorId, provider, externalId]
  );
  return r.rows[0] ?? null;
}

export async function albumBelongsTo(vendorId: number, albumId: number): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM media_albums WHERE id = $1 AND vendor_id = $2", [albumId, vendorId]);
  return (r.rowCount ?? 0) > 0;
}

export async function serviceBelongsTo(vendorId: number, serviceId: number): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM services WHERE id = $1 AND vendor_id = $2", [serviceId, vendorId]);
  return (r.rowCount ?? 0) > 0;
}

async function nextSortOrder(vendorId: number): Promise<number> {
  const r = await pool.query<{ n: number }>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM media_assets WHERE vendor_id = $1",
    [vendorId]
  );
  return Number(r.rows[0]?.n ?? 1);
}

export async function reserveUpload(params: {
  vendorId: number;
  uuid: string;
  kind: "image" | "video_file";
  purpose: MediaPurpose;
  storageDriver: string;
  storageKey: string;
  mime: string;
  bytes: number;
  albumId: number | null;
  serviceId: number | null;
  caption: string;
  durationS: number | null;
}): Promise<MediaAssetRow> {
  const sort = await nextSortOrder(params.vendorId);
  const r = await pool.query<MediaAssetRow>(
    `INSERT INTO media_assets
       (uuid, vendor_id, album_id, service_id, purpose, kind, storage_driver, storage_key,
        mime, bytes, caption, duration_s, status, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'uploading',$13)
     RETURNING *`,
    [
      params.uuid, params.vendorId, params.albumId, params.serviceId, params.purpose, params.kind,
      params.storageDriver, params.storageKey, params.mime, params.bytes, params.caption,
      params.durationS, sort,
    ]
  );
  return r.rows[0];
}

export async function insertVideoLink(params: {
  vendorId: number;
  url: string;
  provider: string;
  externalId: string;
  caption: string;
  albumId: number | null;
  serviceId: number | null;
  status: MediaStatus;
}): Promise<MediaAssetRow> {
  const sort = await nextSortOrder(params.vendorId);
  const r = await pool.query<MediaAssetRow>(
    `INSERT INTO media_assets
       (vendor_id, album_id, service_id, purpose, kind, external_url, external_provider, external_id,
        caption, status, sort_order)
     VALUES ($1,$2,$3,'gallery','video_link',$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      params.vendorId, params.albumId, params.serviceId, params.url, params.provider, params.externalId,
      params.caption, params.status, sort,
    ]
  );
  return r.rows[0];
}

/** Finalises an upload. Returns null when the sha256 collides with another asset (race). */
export async function finalizeAsset(
  vendorId: number,
  id: number,
  fields: {
    variants: Record<string, VariantRef>;
    mime: string;
    bytes: number;
    width: number | null;
    height: number | null;
    sha256: string;
    placeholderColor: string | null;
    status: MediaStatus;
    posterMediaId: number | null;
  }
): Promise<MediaAssetRow | null> {
  try {
    const r = await pool.query<MediaAssetRow>(
      `UPDATE media_assets SET updated_at = now(), variants = $3, mime = $4, bytes = $5, width = $6, height = $7,
              sha256 = $8, placeholder_color = $9, status = $10,
              poster_media_id = COALESCE($11, poster_media_id)
        WHERE id = $1 AND vendor_id = $2
        RETURNING *`,
      [
        id, vendorId, JSON.stringify(fields.variants), fields.mime, fields.bytes, fields.width,
        fields.height, fields.sha256, fields.placeholderColor, fields.status, fields.posterMediaId,
      ]
    );
    return r.rows[0] ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return null;
    throw err;
  }
}

export async function deleteAssetRow(vendorId: number, id: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Clear the denormalised URL caches that point at this asset.
    await client.query(
      `UPDATE vendors SET logo_media_id = NULL, logo_url = NULL WHERE id = $1 AND logo_media_id = $2`,
      [vendorId, id]
    );
    await client.query(
      `UPDATE vendors SET cover_media_id = NULL, cover_image_url = NULL WHERE id = $1 AND cover_media_id = $2`,
      [vendorId, id]
    );
    await client.query("DELETE FROM media_assets WHERE id = $1 AND vendor_id = $2", [id, vendorId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateAssetFields(
  vendorId: number,
  id: number,
  fields: Partial<{
    caption: string;
    alt_text: string;
    album_id: number | null;
    service_id: number | null;
    is_featured: boolean;
    sort_order: number;
    poster_media_id: number | null;
    duration_s: number | null;
    status: MediaStatus;
  }>
): Promise<MediaAssetRow | null> {
  const allowed = [
    "caption", "alt_text", "album_id", "service_id", "is_featured", "sort_order",
    "poster_media_id", "duration_s", "status",
  ] as const;
  const sets: string[] = [];
  const values: unknown[] = [id, vendorId];
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      values.push(fields[k]);
      sets.push(`${k} = $${values.length}`);
    }
  }
  if (sets.length === 0) return findAsset(vendorId, id);
  const r = await pool.query<MediaAssetRow>(
    `UPDATE media_assets SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND vendor_id = $2 RETURNING *`,
    values
  );
  return r.rows[0] ?? null;
}

/** Applies a new order: ids listed first, in that order. Ids not owned by the vendor are ignored. */
export async function reorderAssets(vendorId: number, ids: number[]): Promise<void> {
  await pool.query(
    `UPDATE media_assets m SET sort_order = o.ord, updated_at = now()
       FROM unnest($2::int[]) WITH ORDINALITY AS o(id, ord)
      WHERE m.id = o.id AND m.vendor_id = $1`,
    [vendorId, ids]
  );
}

export async function listAssets(vendorId: number): Promise<MediaAssetRow[]> {
  const r = await pool.query<MediaAssetRow>(
    `SELECT * FROM media_assets
      WHERE vendor_id = $1 AND status <> 'uploading'
      ORDER BY sort_order, id`,
    [vendorId]
  );
  return r.rows;
}

/** Writes vendors.logo_media_id / cover_media_id and the logo_url / cover_image_url cache. */
export async function setVendorImage(
  vendorId: number,
  which: "logo" | "cover",
  mediaId: number | null,
  url: string | null
): Promise<void> {
  if (which === "logo") {
    await pool.query("UPDATE vendors SET logo_media_id = $2, logo_url = $3 WHERE id = $1", [vendorId, mediaId, url]);
  } else {
    await pool.query("UPDATE vendors SET cover_media_id = $2, cover_image_url = $3 WHERE id = $1", [
      vendorId, mediaId, url,
    ]);
  }
}

export async function getVendorImageIds(
  vendorId: number
): Promise<{ logo_media_id: number | null; cover_media_id: number | null }> {
  const r = await pool.query<{ logo_media_id: number | null; cover_media_id: number | null }>(
    "SELECT logo_media_id, cover_media_id FROM vendors WHERE id = $1",
    [vendorId]
  );
  return r.rows[0] ?? { logo_media_id: null, cover_media_id: null };
}

// ---- albums -------------------------------------------------------------

export async function listAlbums(vendorId: number): Promise<MediaAlbumRow[]> {
  const r = await pool.query<MediaAlbumRow>(
    "SELECT * FROM media_albums WHERE vendor_id = $1 ORDER BY sort_order, id",
    [vendorId]
  );
  return r.rows;
}

export async function findAlbum(vendorId: number, id: number): Promise<MediaAlbumRow | null> {
  const r = await pool.query<MediaAlbumRow>("SELECT * FROM media_albums WHERE id = $1 AND vendor_id = $2", [
    id, vendorId,
  ]);
  return r.rows[0] ?? null;
}

export interface AlbumFields {
  title?: string;
  description?: string;
  service_id?: number | null;
  event_type_id?: number | null;
  event_date?: string | null;
  district_id?: number | null;
  venue_name?: string | null;
  cover_media_id?: number | null;
  consent_confirmed?: boolean;
  published?: boolean;
  sort_order?: number;
}

export async function createAlbum(vendorId: number, f: AlbumFields & { title: string }): Promise<MediaAlbumRow> {
  const r = await pool.query<MediaAlbumRow>(
    `INSERT INTO media_albums
       (vendor_id, title, service_id, event_type_id, event_date, district_id, venue_name,
        consent_confirmed_at, published, sort_order, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::boolean THEN now() END, COALESCE($9::boolean, true),
             COALESCE($10::int, (SELECT COALESCE(MAX(sort_order),0)+1 FROM media_albums WHERE vendor_id = $1)), $11)
     RETURNING *`,
    [
      vendorId, f.title, f.service_id ?? null, f.event_type_id ?? null, f.event_date ?? null,
      f.district_id ?? null, f.venue_name ?? null, f.consent_confirmed === true, f.published ?? null,
      f.sort_order ?? null, f.description ?? "",
    ]
  );
  return r.rows[0];
}

export async function updateAlbum(vendorId: number, id: number, f: AlbumFields): Promise<MediaAlbumRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [id, vendorId];
  const cols = [
    "title", "description", "service_id", "event_type_id", "event_date", "district_id", "venue_name",
    "cover_media_id", "published", "sort_order",
  ] as const;
  for (const k of cols) {
    if (f[k] !== undefined) {
      values.push(f[k]);
      sets.push(`${k} = $${values.length}`);
    }
  }
  if (f.consent_confirmed !== undefined) {
    sets.push(f.consent_confirmed ? "consent_confirmed_at = COALESCE(consent_confirmed_at, now())" : "consent_confirmed_at = NULL");
  }
  if (sets.length === 0) return findAlbum(vendorId, id);
  const r = await pool.query<MediaAlbumRow>(
    `UPDATE media_albums SET ${sets.join(", ")} WHERE id = $1 AND vendor_id = $2 RETURNING *`,
    values
  );
  return r.rows[0] ?? null;
}

/** Deletes the album; its photos stay in the gallery (album_id is set to NULL by the FK). */
export async function deleteAlbum(vendorId: number, id: number): Promise<boolean> {
  const r = await pool.query("DELETE FROM media_albums WHERE id = $1 AND vendor_id = $2", [id, vendorId]);
  return (r.rowCount ?? 0) > 0;
}

// ---- serialisation -------------------------------------------------------

export interface ClientAsset {
  id: number;
  kind: MediaKind;
  purpose: MediaPurpose;
  status: MediaStatus;
  statusReason: string | null;
  albumId: number | null;
  serviceId: number | null;
  caption: string;
  altText: string;
  isFeatured: boolean;
  sortOrder: number;
  width: number | null;
  height: number | null;
  bytes: number | null;
  durationS: number | null;
  placeholderColor: string | null;
  posterMediaId: number | null;
  /** thumb/card/full for images; video for MP4. Missing sizes fall back to full. */
  urls: { thumb?: string; card?: string; full?: string; video?: string };
  provider: "youtube" | "instagram" | "vimeo" | null;
  externalUrl: string | null;
  externalId: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
}

export function assetUrls(row: Pick<MediaAssetRow, "storage_driver" | "storage_key" | "variants">): ClientAsset["urls"] {
  const urls: ClientAsset["urls"] = {};
  if (!row.storage_driver) return urls;
  // Legacy portfolio rows copied by migration 004: storage_key is a plain URL.
  if (row.storage_driver === "url") {
    const k = row.storage_key ?? "";
    if (/^https?:\/\//i.test(k) || (k.startsWith("/") && !k.startsWith("//"))) urls.full = k;
    return { thumb: urls.full, card: urls.full, full: urls.full };
  }
  let storage;
  try {
    storage = getStorage(row.storage_driver);
  } catch {
    return urls;
  }
  const variants = row.variants ?? {};
  for (const name of ["thumb", "card", "full", "video"] as const) {
    const v = variants[name];
    if (v?.key && isSafeKey(v.key)) urls[name] = storage.publicUrl(v.key);
  }
  // Legacy local rows without variants: the key is the file itself.
  if (!urls.full && !urls.video && Object.keys(variants).length === 0 && row.storage_key && isSafeKey(row.storage_key)) {
    urls.full = storage.publicUrl(row.storage_key);
  }
  if (urls.full) {
    urls.thumb ??= urls.full;
    urls.card ??= urls.full;
  }
  return urls;
}

export function toClientAsset(row: MediaAssetRow): ClientAsset {
  const thumbnailUrl =
    row.kind === "video_link" && row.external_provider === "youtube" && row.external_id
      ? `https://i.ytimg.com/vi/${row.external_id}/hqdefault.jpg`
      : null;
  return {
    id: row.id,
    kind: row.kind,
    purpose: row.purpose,
    status: row.status,
    statusReason: row.status_reason,
    albumId: row.album_id,
    serviceId: row.service_id,
    caption: row.caption,
    altText: row.alt_text,
    isFeatured: row.is_featured,
    sortOrder: row.sort_order,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    durationS: row.duration_s,
    placeholderColor: row.placeholder_color,
    posterMediaId: row.poster_media_id,
    urls: assetUrls(row),
    provider: row.external_provider,
    externalUrl: row.external_url,
    externalId: row.external_id,
    thumbnailUrl,
    createdAt: row.created_at,
  };
}

export function toClientAlbum(row: MediaAlbumRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    serviceId: row.service_id,
    eventTypeId: row.event_type_id,
    eventDate: row.event_date,
    districtId: row.district_id,
    venueName: row.venue_name,
    coverMediaId: row.cover_media_id,
    consentConfirmedAt: row.consent_confirmed_at,
    published: row.published,
    sortOrder: row.sort_order,
  };
}
