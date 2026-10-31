// Search card images (PRODUCT_PLAN 4.6 "Search card image fallback"), one
// query for a whole results page. Only approved media of approved, published
// vendors is ever read here. Chain per vendor:
//   1. the vendor's cover (if that asset is approved; legacy cover_image_url
//      rows without a cover asset keep their URL),
//   2. the first featured approved gallery image,
//   3. the first approved gallery image,
//   4. nothing -> the card shows the category gradient.

import { pool, type VendorRecord } from "@/lib/db";
import { assetUrls } from "@/lib/media/repo";

export interface CardMedia {
  src: string | null;
  color: string | null;
  hasVideo: boolean;
  photoCount: number;
}

interface Row {
  vendor_id: number;
  id: number;
  kind: string;
  purpose: string;
  is_featured: boolean;
  storage_driver: string | null;
  storage_key: string | null;
  variants: Record<string, { key: string }>;
  placeholder_color: string | null;
}

export async function findCardMedia(vendors: VendorRecord[]): Promise<Map<number, CardMedia>> {
  const out = new Map<number, CardMedia>();
  const ids = vendors.filter((v) => v.status === "approved" && v.published !== false).map((v) => v.id);
  const rows = ids.length
    ? (
        await pool.query<Row>(
          `SELECT m.vendor_id, m.id, m.kind, m.purpose, m.is_featured, m.storage_driver, m.storage_key,
                  m.variants, m.placeholder_color
             FROM media_assets m
             JOIN vendors v ON v.id = m.vendor_id
            WHERE m.vendor_id = ANY($1::int[]) AND m.status = 'approved'
              AND v.status = 'approved' AND v.published
              AND (m.id = v.cover_media_id OR m.purpose = 'gallery')
            ORDER BY m.vendor_id, m.is_featured DESC, m.sort_order, m.id`,
          [ids]
        )
      ).rows
    : [];
  const byVendor = new Map<number, Row[]>();
  for (const r of rows) {
    const list = byVendor.get(r.vendor_id) ?? [];
    list.push(r);
    byVendor.set(r.vendor_id, list);
  }

  for (const v of vendors) {
    const list = byVendor.get(v.id) ?? [];
    const images = list.filter((r) => r.kind === "image" && r.purpose === "gallery");
    const card = (r: Row) => {
      const u = assetUrls(r);
      return u.card ?? u.full ?? null;
    };
    let src: string | null = null;
    let color: string | null = null;
    const cover = v.cover_media_id ? list.find((r) => r.id === v.cover_media_id && r.kind === "image") : undefined;
    if (cover) {
      src = card(cover);
      color = cover.placeholder_color;
    } else if (!v.cover_media_id && v.cover_image_url) {
      src = v.cover_image_url;
    }
    if (!src) {
      // Sorted featured first, so the first image is "featured, else first".
      const pick = images.find((r) => card(r));
      if (pick) {
        src = card(pick);
        color = pick.placeholder_color;
      }
    }
    out.set(v.id, {
      src,
      color,
      hasVideo: list.some((r) => r.kind === "video_file" || r.kind === "video_link"),
      photoCount: images.length,
    });
  }
  return out;
}
