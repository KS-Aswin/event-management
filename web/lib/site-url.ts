// Public origin for canonical/Open Graph links, robots.txt and sitemap.xml.
// NEXT_PUBLIC_SITE_URL wins; on Vercel the project's production domain is the
// fallback (VERCEL_PROJECT_PRODUCTION_URL is set at build and run time); local
// development falls back to http://localhost:3000.
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}
