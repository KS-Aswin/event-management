import type { MetadataRoute } from "next";
import { findVendors } from "@/lib/db";

// Regenerate at most hourly so new vendors appear without a rebuild.
export const revalidate = 3600;

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/search`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/for-vendors`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/about`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/help`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];

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

  return [...staticPages, ...vendorPages];
}
