import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // Lets the e2e suite run its own dev server beside another one (separate
  // build dir and dev lock). Unset in normal use, so the default .next is kept.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Dev only: comma-separated hosts (e.g. your LAN IP) allowed to load the dev
  // server, so it can be opened from a phone on the same Wi-Fi.
  ...(process.env.DEV_ORIGINS
    ? { allowedDevOrigins: process.env.DEV_ORIGINS.split(",").map((s) => s.trim()) }
    : {}),
  // YouTube video-link thumbnails (docs/PRODUCT_PLAN.md 4.5).
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" }],
  },
  experimental: {
    // Uploads go through the local-driver PUT route (MP4 up to 50 MB). When
    // proxy.ts is present Next buffers request bodies up to this size; the
    // default 10 MB would truncate them.
    proxyClientMaxBodySize: "60mb",
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
