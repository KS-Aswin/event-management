// Client IP for rate limiting (QA-005). Pure (no imports) so it can be unit
// tested from tests/qa1-auth.test.mjs and used anywhere.
//
// Env:
//   TRUST_PROXY=1  a proxy in front of the app overwrites X-Forwarded-For,
//                  so its first value is the real client (self-hosting).
//   TRUST_PROXY=0  never trust the first X-Forwarded-For value.
//   (unset)        trusted only outside production (local dev and the test
//                  suites send a per-run X-Forwarded-For so their limits
//                  start fresh each run).
//   VERCEL         set by Vercel: x-real-ip / x-vercel-forwarded-for are
//                  written by the platform and can't be spoofed.

export function trustForwardedFor(): boolean {
  const v = (process.env.TRUST_PROXY ?? "").toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  // Local dev and the test suites send a per-run X-Forwarded-For so their
  // limits start fresh each run. Never trusted in production unless
  // TRUST_PROXY says a proxy in front overwrites the header.
  return process.env.NODE_ENV !== "production";
}

function cleanIp(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s ? s.slice(0, 64) : null;
}

/**
 * Client IP for rate limiting. The first X-Forwarded-For value is whatever
 * the client typed, so it is only used when a trusted proxy sets it (or in
 * development). On Vercel the platform sets x-real-ip /
 * x-vercel-forwarded-for itself. Otherwise the right-most X-Forwarded-For hop
 * (added by the nearest proxy) is used.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const hops = xff ? xff.split(",").map((h) => h.trim()).filter(Boolean) : [];
  if (trustForwardedFor() && hops.length) return cleanIp(hops[0])!;
  if (process.env.VERCEL) {
    const vercel =
      cleanIp(headers.get("x-vercel-forwarded-for")?.split(",")[0]) ?? cleanIp(headers.get("x-real-ip"));
    if (vercel) return vercel;
  }
  if (hops.length) return cleanIp(hops[hops.length - 1])!;
  return cleanIp(headers.get("x-real-ip")) ?? "unknown";
}
