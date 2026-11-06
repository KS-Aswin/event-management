import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// CSRF hardening for the session-setting auth endpoints (login, register,
// logout). SameSite=Lax cookies do not protect these, because a cross-site
// top-level form POST can still set or clear the session cookie. The checks
// live in lib/csrf.ts (proxy.ts applies the general version to every
// mutating /api request, QA-080).
export { rejectCrossSite } from "@/lib/csrf";

/** Friendly 429 with Retry-After, in the { error } shape the forms display. */
export function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many attempts. Please wait a few minutes and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

/** users.last_login_at for the admin user page (QA-017). Never throws. */
export async function recordSignIn(userId: number): Promise<void> {
  try {
    await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  } catch (err) {
    console.error("recordSignIn failed", err);
  }
}

/** UTF-8 byte length (bcrypt only uses the first 72 bytes of a password). */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Longest password accepted on sign-up / reset (bcrypt's 72-byte input). */
export const MAX_PASSWORD_BYTES = 72;
/** Longest password even looked at on sign-in (anything longer is never valid). */
export const MAX_LOGIN_PASSWORD_LENGTH = 1024;
