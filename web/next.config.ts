import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/** Origin of an env URL (storage hosts), or null if unset/invalid. */
function originOf(v: string | undefined): string | null {
  try {
    return v ? new URL(v.trim()).origin : null;
  } catch {
    return null;
  }
}

// Media may be served from (or uploaded straight to, with signed URLs) the
// storage host: Supabase, S3/R2 or a public bucket URL. Read at build time.
const storageOrigins = [
  ...new Set(
    [process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.S3_ENDPOINT, process.env.S3_PUBLIC_URL]
      .map(originOf)
      .filter((o): o is string => !!o)
  ),
];

// QA-054: a real Content-Security-Policy. Next.js inlines its bootstrap
// scripts and styles; a nonce would need proxy.ts on every page and would
// make every page dynamic (no static/ISR pages), so scripts and styles allow
// 'unsafe-inline' from this origin only. Everything an injected script would
// need beyond that is shut: no plugins (object-src), no <base> hijack, forms
// post only here, frames only the video players we embed, and fetch/XHR only
// to this origin and the storage host.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  // globals.css @imports Inter and Poppins from Google Fonts.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  ["img-src 'self' data: blob: https://i.ytimg.com", ...storageOrigins].join(" "),
  ["media-src 'self' blob:", ...storageOrigins].join(" "),
  "font-src 'self' data: https://fonts.gstatic.com",
  ["connect-src 'self'", ...storageOrigins, ...(isProd ? [] : ["ws:", "wss:"])].join(" "),
  "frame-src https://www.youtube-nocookie.com https://www.instagram.com https://player.vimeo.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: csp },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // QA-054: don't advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
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
