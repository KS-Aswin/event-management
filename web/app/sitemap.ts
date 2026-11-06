import type { MetadataRoute } from "next";
import { findTaxonomy, findVendors } from "@/lib/db";
import { siteUrl } from "@/lib/site-url";

// Rendered per request (not at build time), so it always uses the deployed
// public URL (lib/site-url.ts) and the live vendor list; the build never needs
// the database.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/search`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/for-vendors`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/about`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/help`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Browse pages (P2-8): one per active event type and category.
  let browsePages: MetadataRoute.Sitemap = [];
  try {
    const taxonomy = await findTaxonomy();
    browsePages = [
      ...taxonomy.eventTypes
        .filter((e) => e.slug !== "other")
        .map((e) => ({ url: `${base}/e/${e.slug}`, changeFrequency: "weekly" as const, priority: 0.7 })),
      ...taxonomy.categories
        .filter((c) => c.active)
        .map((c) => ({ url: `${base}/c/${c.slug}`, changeFrequency: "weekly" as const, priority: 0.7 })),
    ];
  } catch (err) {
    console.error("sitemap: could not load taxonomy", err);
  }

  let vendorPages: MetadataRoute.Sitemap = [];
  try {
    const vendors = await findVendors({});
    vendorPages = vendors
      .filter((v) => !v.status || v.status === "approved")
      .map((v) => ({
        url: `${base}/vendors/${v.id}`,
        lastModified: v.created_at ? new Date(v.created_at) : undefined,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      }));
  } catch (err) {
    // Database unavailable (e.g. at build time): fall back to static pages only.
    console.error("sitemap: could not load vendors", err);
  }

  return [...staticPages, ...browsePages, ...vendorPages];
}
