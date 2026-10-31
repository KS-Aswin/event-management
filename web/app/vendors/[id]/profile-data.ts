// Server-only data for the public vendor profile (P0-15, PRODUCT_PLAN 4.6):
// the media a viewer may see, shaped for the client gallery, and the
// offerings tree (units grouped by category, packages with their units).
//
// Visibility: anyone gets `approved` media only. The owner's (or an admin's)
// preview also gets `pending_review` items, flagged `pending` so the UI can
// badge them. Rejected, hidden and uploading rows never leave this file.

import {
  findAlbumsByVendor,
  findMediaByVendor,
  findOfferingsByVendor,
  findPackageItems,
  type MediaAssetRecord,
  type OfferingRecord,
  type VendorRecord,
} from "@/lib/db";
import { assetUrls } from "@/lib/media/repo";
import { parseVideoLink } from "@/lib/media/video-link";
import { formatOfferingPrice, maskContactDetails } from "@/lib/offering-validation";

export interface GalleryItem {
  id: number;
  kind: "image" | "video_file" | "video_link";
  albumId: number | null;
  caption: string;
  alt: string;
  pending: boolean;
  width: number | null;
  height: number | null;
  placeholderColor: string | null;
  /** Images: thumb/card/full. MP4: video (+ poster from its poster image). */
  thumb: string | null;
  card: string | null;
  full: string | null;
  video: string | null;
  poster: string | null;
  provider: "youtube" | "instagram" | "vimeo" | null;
  externalUrl: string | null;
  embedUrl: string | null;
}

export interface GalleryAlbum {
  id: number;
  title: string;
  description: string;
  count: number;
}

export interface ProfileMedia {
  coverUrl: string | null;
  coverColor: string | null;
  logoUrl: string | null;
  photos: GalleryItem[];
  videos: GalleryItem[];
  albums: GalleryAlbum[];
  hasPending: boolean;
}

function toItem(row: MediaAssetRecord, byId: Map<number, MediaAssetRecord>): GalleryItem {
  const urls = assetUrls(row);
  let poster: string | null = null;
  if (row.kind === "video_file" && row.poster_media_id) {
    const p = byId.get(row.poster_media_id);
    if (p) {
      const pu = assetUrls(p);
      poster = pu.card ?? pu.full ?? null;
    }
  }
  let embedUrl: string | null = null;
  let thumb: string | null = urls.thumb ?? null;
  let card: string | null = urls.card ?? null;
  if (row.kind === "video_link") {
    const parsed = row.external_url ? parseVideoLink(row.external_url) : null;
    embedUrl = parsed?.embedUrl ?? null;
    thumb = card = parsed?.thumbnailUrl ?? null;
  }
  return {
    id: row.id,
    kind: row.kind,
    albumId: row.album_id,
    caption: row.caption ?? "",
    alt: row.alt_text || row.caption || "",
    pending: row.status === "pending_review",
    width: row.width,
    height: row.height,
    placeholderColor: row.placeholder_color,
    thumb,
    card,
    full: urls.full ?? null,
    video: urls.video ?? null,
    poster,
    provider: row.external_provider,
    externalUrl: row.external_url,
    embedUrl,
  };
}

export async function loadProfileMedia(vendor: VendorRecord, preview: boolean): Promise<ProfileMedia> {
  const [rows, albumRows] = await Promise.all([
    findMediaByVendor(vendor.id, preview ? {} : { publicOnly: true }),
    findAlbumsByVendor(vendor.id, { publicOnly: !preview }),
  ]);
  const visible = rows.filter((r) =>
    preview ? r.status === "approved" || r.status === "pending_review" : r.status === "approved"
  );
  const byId = new Map(visible.map((r) => [r.id, r]));

  // Gallery = purpose 'gallery'. Logo, cover and video posters are shown in
  // their own places. A photo in an unpublished album stays out of the public
  // gallery too.
  const albumIds = new Set(albumRows.map((a) => a.id));
  const gallery = visible.filter(
    (r) => r.purpose === "gallery" && (r.album_id == null || albumIds.has(r.album_id))
  );
  const photos = gallery
    .filter((r) => r.kind === "image")
    .map((r) => toItem(r, byId))
    .filter((i) => i.full);
  const videos = gallery
    .filter((r) => r.kind === "video_file" || r.kind === "video_link")
    .map((r) => toItem(r, byId))
    .filter((i) => i.video || i.embedUrl || i.externalUrl);

  // Cover: the chosen cover asset (if this viewer may see it). Legacy rows
  // with only cover_image_url keep it. Otherwise first featured photo, then
  // first photo; the page falls back to the category gradient.
  let coverUrl: string | null = null;
  let coverColor: string | null = null;
  if (vendor.cover_media_id) {
    const c = byId.get(vendor.cover_media_id);
    if (c) {
      coverUrl = assetUrls(c).full ?? null;
      coverColor = c.placeholder_color;
    }
  } else if (vendor.cover_image_url) {
    coverUrl = vendor.cover_image_url;
  }
  if (!coverUrl && photos.length) {
    // findMediaByVendor sorts featured first, so photos[0] is the best pick.
    coverUrl = photos[0].full;
    coverColor = photos[0].placeholderColor;
  }

  let logoUrl: string | null = null;
  if (vendor.logo_media_id) {
    const l = byId.get(vendor.logo_media_id);
    if (l) logoUrl = assetUrls(l).card ?? assetUrls(l).full ?? null;
  } else if (vendor.logo_url) {
    logoUrl = vendor.logo_url;
  }

  const counts = new Map<number, number>();
  for (const i of [...photos, ...videos]) {
    if (i.albumId != null) counts.set(i.albumId, (counts.get(i.albumId) ?? 0) + 1);
  }
  const albums = albumRows
    .map((a) => ({ id: a.id, title: a.title, description: a.description ?? "", count: counts.get(a.id) ?? 0 }))
    .filter((a) => a.count > 0);

  return {
    coverUrl,
    coverColor,
    logoUrl,
    photos,
    videos,
    albums,
    hasPending: [...photos, ...videos].some((i) => i.pending),
  };
}

// ---------------------------------------------------------------------------
// Offerings tree
// ---------------------------------------------------------------------------

export interface OfferingView {
  id: number;
  kind: "unit" | "package" | "addon";
  title: string;
  description: string;
  priceText: string;
  priceUnit: string;
  separate: boolean;
  inclusions: string[];
  guestRange: string | null;
  addons: OfferingView[];
  /** Packages: the units they include. */
  items: { id: number; title: string; qty: string; note: string }[];
}

export interface OfferingGroup {
  category: string;
  slug: string;
  units: OfferingView[];
  /** Package-only units: listed under "Included in our packages". */
  packageOnly: OfferingView[];
}

export interface ProfileOfferings {
  groups: OfferingGroup[];
  packages: OfferingView[];
  /** What the quote dialog may offer: separately bookable units and packages. */
  quoteable: { id: number; title: string }[];
  total: number;
}

function guestRange(o: OfferingRecord): string | null {
  if (o.guest_min && o.guest_max) return `${o.guest_min}–${o.guest_max} guests`;
  if (o.guest_max) return `Up to ${o.guest_max} guests`;
  if (o.guest_min) return `From ${o.guest_min} guests`;
  return null;
}

function trimQty(q: string): string {
  const n = Number(q);
  return Number.isFinite(n) ? String(n) : q;
}

export async function loadProfileOfferings(vendorId: number): Promise<ProfileOfferings> {
  const rows = await findOfferingsByVendor(vendorId, { publicOnly: true });
  const packageRows = rows.filter((o) => o.kind === "package");
  const items = await findPackageItems(packageRows.map((p) => p.id));
  const visibleIds = new Set(rows.map((r) => r.id));

  const view = (o: OfferingRecord): OfferingView => ({
    id: o.id,
    kind: o.kind,
    title: o.title,
    description: maskContactDetails(o.description ?? "").text,
    priceText: formatOfferingPrice(o),
    priceUnit: o.price_unit,
    separate: o.kind !== "addon" && o.sale_mode === "separate",
    inclusions: Array.isArray(o.inclusions) ? o.inclusions : [],
    guestRange: guestRange(o),
    addons: [],
    items: [],
  });

  const units = new Map<number, OfferingView>();
  const groups = new Map<string, OfferingGroup>();
  for (const o of rows) {
    if (o.kind !== "unit") continue;
    const v = view(o);
    units.set(o.id, v);
    let g = groups.get(o.category);
    if (!g) {
      g = { category: o.category, slug: o.category_slug, units: [], packageOnly: [] };
      groups.set(o.category, g);
    }
    (o.sale_mode === "package_only" ? g.packageOnly : g.units).push(v);
  }
  for (const o of rows) {
    if (o.kind !== "addon" || o.parent_service_id == null) continue;
    units.get(o.parent_service_id)?.addons.push(view(o));
  }
  const packages = packageRows.map((p) => {
    const v = view(p);
    v.separate = true;
    v.items = items
      .filter((i) => i.package_id === p.id && i.active && visibleIds.has(i.item_id))
      .map((i) => ({ id: i.item_id, title: i.title, qty: trimQty(i.qty), note: i.note ?? "" }));
    return v;
  });

  const groupList = [...groups.values()].filter((g) => g.units.length || g.packageOnly.length);
  const quoteable = [
    ...groupList.flatMap((g) => g.units.map((u) => ({ id: u.id, title: u.title }))),
    ...packages.map((p) => ({ id: p.id, title: `${p.title} (package)` })),
  ];
  return { groups: groupList, packages, quoteable, total: units.size + packages.length };
}
