// Simple in-memory sliding-window rate limiter.
// Per-process only: good enough for a single Node server / local dev. On a
// multi-instance deployment, swap this for a shared store (e.g. Redis).

const hits = new Map<string, number[]>();
const MAX_KEYS = 10_000;

/**
 * Records one attempt for `key` and returns true if it is allowed
 * (fewer than `max` attempts in the last `windowMs` ms), false if limited.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }

  recent.push(now);
  hits.set(key, recent);

  // Keep memory bounded: drop the oldest keys if the map grows too large.
  if (hits.size > MAX_KEYS) {
    for (const k of hits.keys()) {
      hits.delete(k);
      if (hits.size <= MAX_KEYS / 2) break;
    }
  }
  return true;
}

/** Best-effort client identifier from proxy headers (falls back to "unknown"). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
