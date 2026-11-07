import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Per request, so the sitemap link uses the deployed public URL (lib/site-url.ts).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/settings", "/login", "/signup"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
