import { createHash } from "crypto";
import { pool } from "@/lib/db";

// Two limiters:
//
// - checkRateLimit(): in-memory sliding window, per server process. Cheap and
//   synchronous; fine for per-user write throttles (messages, shortlist...).
//
// - rateLimitHit() / rateLimitPeek() / rateLimitReset(): a fixed-window
//   counter shared by every server instance through Postgres
//   (rate_limit_counters, migration 014). Use these for the abuse limits that
//   must hold on serverless hosting, where each instance has its own memory:
//   sign-in, sign-up, password reset. If the DB call fails they fall back to
//   the in-memory limiter, so a DB hiccup never turns limits off entirely.

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

function memoryCount(key: string, windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return (hits.get(key) ?? []).filter((t) => t > cutoff).length;
}

/** Keys are hashed so the table never holds raw emails or IPs. */
function dbKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

let lastSweep = 0;
/** Deletes long-expired counters, at most once a minute per instance. */
function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  pool.query("DELETE FROM rate_limit_counters WHERE reset_at < now() - interval '1 hour'").catch(() => {});
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfter: number;
  /** Attempts counted in the current window, including this one for rateLimitHit (best effort on the memory fallback). */
  hits?: number;
}

/**
 * Records one attempt for `key` in the shared store. `ok` is false once more
 * than `max` attempts fell in the current window of `windowMs`.
 */
export async function rateLimitHit(key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  try {
    const { rows } = await pool.query<{ hits: number; retry: number }>(
      `INSERT INTO rate_limit_counters (key, hits, reset_at)
       VALUES ($1, 1, now() + make_interval(secs => $2::float8 / 1000))
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limit_counters.reset_at <= now() THEN 1 ELSE rate_limit_counters.hits + 1 END,
         reset_at = CASE WHEN rate_limit_counters.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limit_counters.reset_at END
       RETURNING hits, CEIL(EXTRACT(EPOCH FROM (reset_at - now())))::int AS retry`,
      [dbKey(key), windowMs]
    );
    sweep();
    const r = rows[0];
    return { ok: r.hits <= max, retryAfter: Math.max(1, r.retry), hits: r.hits };
  } catch (err) {
    console.error("rateLimitHit: shared store unavailable, using memory", err);
    const ok = checkRateLimit(key, max, windowMs);
    return { ok, retryAfter: Math.ceil(windowMs / 1000), hits: ok ? memoryCount(key, windowMs) : max + 1 };
  }
}

/**
 * True while `key` has fewer than `max` attempts in its current window,
 * without recording one. Pair with rateLimitHit() to count only failures
 * (e.g. wrong passwords) and check before doing the expensive work.
 */
export async function rateLimitPeek(key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  try {
    const { rows } = await pool.query<{ hits: number; retry: number }>(
      `SELECT hits, CEIL(EXTRACT(EPOCH FROM (reset_at - now())))::int AS retry
         FROM rate_limit_counters WHERE key = $1 AND reset_at > now()`,
      [dbKey(key)]
    );
    const r = rows[0];
    if (!r) return { ok: true, retryAfter: 0, hits: 0 };
    return { ok: r.hits < max, retryAfter: Math.max(1, r.retry), hits: r.hits };
  } catch (err) {
    console.error("rateLimitPeek: shared store unavailable, using memory", err);
    return { ok: memoryCount(key, windowMs) < max, retryAfter: Math.ceil(windowMs / 1000) };
  }
}

/** Clears `key` (e.g. failed sign-ins after a successful one). */
export async function rateLimitReset(key: string): Promise<void> {
  hits.delete(key);
  try {
    await pool.query("DELETE FROM rate_limit_counters WHERE key = $1", [dbKey(key)]);
  } catch {
    // Best effort: the window expires on its own.
  }
}

export { clientIp } from "@/lib/client-ip";
