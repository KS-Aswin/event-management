// Client IP for rate limiting and the audit log (QA-005). No imports, so it
// can be unit tested from tests/qa1-auth.test.mjs / qa2-sec.test.mjs and used
// anywhere.
//
// Where the IP comes from, most trusted first:
//
//   TRUST_PROXY=<n>  n reverse proxies (nginx, Caddy, a load balancer) sit in
//                    front of the app and each appends the address it saw to
//                    X-Forwarded-For. The client is the n-th hop from the
//                    right; anything further left was typed by the client.
//                    "1" / "true" mean one proxy (the usual self-host setup).
//   VERCEL           set by Vercel: x-vercel-forwarded-for / x-real-ip are
//                    written by the platform and can't be spoofed.
//   socket peer      otherwise the TCP peer address, stamped on every request
//                    by lib/peer-ip.ts (installed from instrumentation.ts)
//                    under a per-process secret header name, so a client
//                    can't forge it. X-Forwarded-For is ignored entirely.
//   fallback         no IP at all (peer stamp not installed): a per-client
//                    bucket from browser headers, never one shared "unknown"
//                    bucket that a single noisy client could fill for everyone.
//
// TRUST_PROXY=0 forces "no proxy" (socket peer). Left unset outside
// production, the first X-Forwarded-For value is used so local dev and the
// test suites can give each run its own IP.

/** globalThis key where lib/peer-ip.ts publishes its secret header name. */
export const PEER_HEADER_KEY = "__velaPeerIpHeader";

/** Number of trusted proxy hops; 0 = don't read X-Forwarded-For; null = unset. */
export function trustedProxyHops(): number | null {
  const v = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  if (v === "") return null;
  if (v === "true" || v === "yes") return 1;
  if (v === "false" || v === "no") return 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 0; // unparseable: safest choice
}

/** True when X-Forwarded-For is read at all (kept for older callers/tests). */
export function trustForwardedFor(): boolean {
  const hops = trustedProxyHops();
  if (hops === null) return process.env.NODE_ENV !== "production";
  return hops > 0;
}

function cleanIp(v: string | null | undefined): string | null {
  let s = v?.trim();
  if (!s) return null;
  if (s.startsWith("::ffff:") && s.includes(".")) s = s.slice(7); // IPv4-mapped IPv6
  return s.slice(0, 64);
}

function forwardedHops(headers: Headers): string[] {
  const xff = headers.get("x-forwarded-for");
  return xff ? xff.split(",").map((h) => h.trim()).filter(Boolean) : [];
}

/** The TCP peer stamped by lib/peer-ip.ts, or null when it isn't installed. */
function peerIp(headers: Headers): string | null {
  const name = (globalThis as Record<string, unknown>)[PEER_HEADER_KEY];
  return typeof name === "string" && name ? cleanIp(headers.get(name)) : null;
}

/**
 * The client's IP address, or null when no trustworthy one is known. Use
 * this for records (audit log, reset links); use clientIp() for rate-limit
 * keys.
 */
export function requestIp(headers: Headers): string | null {
  const hops = trustedProxyHops();
  const xff = forwardedHops(headers);
  if (hops === null && process.env.NODE_ENV !== "production" && xff.length) return cleanIp(xff[0]);
  if (hops !== null && hops > 0 && xff.length) {
    // n-th from the right; if there are fewer hops than proxies, the left-most
    // one is still what the first proxy saw.
    return cleanIp(xff[Math.max(0, xff.length - hops)]);
  }
  if (process.env.VERCEL) {
    const vercel =
      cleanIp(headers.get("x-vercel-forwarded-for")?.split(",")[0]) ?? cleanIp(headers.get("x-real-ip"));
    if (vercel) return vercel;
  }
  const peer = peerIp(headers);
  if (peer && xff.length && hops === null) warnProxyOnce(peer);
  return peer;
}

let warned = false;
/**
 * A loopback/private peer that sends X-Forwarded-For is almost certainly a
 * reverse proxy: without TRUST_PROXY every visitor then shares the proxy's
 * address (and its rate limits). Say so once in the server log.
 */
function warnProxyOnce(peer: string) {
  if (warned) return;
  if (!/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:)/i.test(peer)) return;
  warned = true;
  console.warn(
    `[vela] Requests arrive through a proxy (${peer}) with X-Forwarded-For, but TRUST_PROXY is not set, ` +
      "so every visitor shares the proxy's rate limits. Set TRUST_PROXY=1 (one proxy that appends or " +
      "overwrites X-Forwarded-For) - see docs/DEPLOY.md."
  );
}

/** FNV-1a, 32-bit, hex. Bucketing only, not security. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Rate-limit key for the client: its IP, or (no IP known) "anon:<hash>" of
 * the browser's own headers. Those can be rotated, so the per-account limits
 * still carry the weight in that case, but one client can no longer lock
 * every IP-less visitor out of sign-in, sign-up and enquiries.
 */
export function clientIp(headers: Headers): string {
  const ip = requestIp(headers);
  if (ip) return ip;
  const ua = headers.get("user-agent") ?? "";
  const lang = headers.get("accept-language") ?? "";
  const hints = headers.get("sec-ch-ua") ?? "";
  return `anon:${fnv1a(`${ua}\n${lang}\n${hints}`)}`;
}
