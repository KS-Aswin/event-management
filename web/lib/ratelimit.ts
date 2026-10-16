// Tiny in-memory rate limiter (fixed window), keyed by any string.
//
// Limits are only enforced in production (or when RATE_LIMIT=on) so local
// development and the automated test suite aren't throttled.
//
// Honest limitation: state lives in one server process. On serverless hosts
// (e.g. Vercel) each instance has its own counters, so this slows down abuse
// but is not a hard guarantee. For a hard limit, back it with Redis/Upstash.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function enabled(): boolean {
  return process.env.RATE_LIMIT === "on" || process.env.NODE_ENV === "production";
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterSeconds: number } {
  if (!enabled()) return { ok: true, retryAfterSeconds: 0 };

  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}
