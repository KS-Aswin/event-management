import { createHash } from "crypto";
import { pool } from "@/lib/db";

// Server-side revocation of single session tokens (QA-081, migration 017).
// No next/headers import on purpose: proxy.ts uses it too.
//
// "Log out" revokes only the token of the device that signs out (like any
// real app). Ending every other session is a users.session_version bump
// ("Sign out of other devices", password change, admin force logout).

/** Tokens are stored hashed, so the table never holds a usable cookie. */
export function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * True when this token was signed out. Fails open on a DB error (the token
 * is still signature- and expiry-checked, and the user row check that runs
 * next fails closed), so a DB hiccup doesn't sign everybody out.
 */
export async function isSessionRevoked(token: string): Promise<boolean> {
  try {
    const { rowCount } = await pool.query("SELECT 1 FROM revoked_sessions WHERE token_hash = $1", [sessionTokenHash(token)]);
    return (rowCount ?? 0) > 0;
  } catch (err) {
    // Before migration 017 the table is missing: nothing is revoked yet.
    if (!(err && typeof err === "object" && "code" in err && err.code === "42P01")) {
      console.error("isSessionRevoked failed", err);
    }
    return false;
  }
}

/** Records the token as signed out until it would have expired (expSeconds: JWT exp). */
export async function revokeSessionToken(token: string, userId: number | null, expSeconds: number | null): Promise<void> {
  const expires = expSeconds && Number.isFinite(expSeconds) ? new Date(expSeconds * 1000) : new Date(Date.now() + 7 * 864e5);
  if (expires.getTime() <= Date.now()) return; // already expired
  await pool.query(
    `INSERT INTO revoked_sessions (token_hash, user_id, expires_at)
     VALUES ($1, (SELECT id FROM users WHERE id = $2), $3)
     ON CONFLICT (token_hash) DO NOTHING`,
    [sessionTokenHash(token), userId, expires]
  );
  pool.query("DELETE FROM revoked_sessions WHERE expires_at < now()").catch(() => {});
}
