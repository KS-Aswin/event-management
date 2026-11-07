import { NextResponse } from "next/server";
import { pool, findUserById, type UserRecord } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";
import { rateLimitHit, rateLimitPeek } from "@/lib/rate-limit";
import { MAX_LOGIN_PASSWORD_LENGTH, tooManyRequests } from "../auth/_guard";
import type { SessionPayload } from "@/lib/session";

// Shared by the account-security actions (QA-059, QA-080, QA-081): checking
// the current password before a sensitive change, and ending every other
// session while keeping this one signed in.

const WINDOW_MS = 15 * 60 * 1000;
// Wrong current passwords per account per 15 min: someone at an unlocked,
// signed-in device can't use these forms to guess the password.
const MAX_FAILS = 10;

/**
 * Checks `password` against the signed-in user's current password. Returns
 * the user row, or a response to send: 400 { field: "currentPassword" } for
 * a missing or wrong password, 429 after too many wrong ones.
 */
export async function requireCurrentPassword(
  userId: number,
  password: unknown
): Promise<UserRecord | NextResponse> {
  if (typeof password !== "string" || !password) {
    return NextResponse.json(
      { field: "currentPassword", error: "Enter your current password." },
      { status: 400 }
    );
  }
  const key = `account:pwfail:${userId}`;
  const peek = await rateLimitPeek(key, MAX_FAILS, WINDOW_MS);
  if (!peek.ok) return tooManyRequests(peek.retryAfter);
  const user = await findUserById(userId);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const valid = password.length <= MAX_LOGIN_PASSWORD_LENGTH && (await verifyPassword(password, user.password_hash));
  if (!valid) {
    const hit = await rateLimitHit(key, MAX_FAILS, WINDOW_MS);
    if (!hit.ok) return tooManyRequests(hit.retryAfter);
    return NextResponse.json(
      { field: "currentPassword", error: "That isn't your current password." },
      { status: 400 }
    );
  }
  return user;
}

/**
 * Signs out every other device (bumps users.session_version, the same
 * mechanism as an admin force logout) and re-issues this device's cookie
 * with the new version, so the user stays signed in here. Pass `sql` and
 * `params` to change other columns in the same UPDATE ($1 is the user id).
 */
export async function endOtherSessions(
  session: SessionPayload,
  set: { sql?: string; params?: unknown[] } = {}
): Promise<boolean> {
  const extra = set.sql ? `, ${set.sql}` : "";
  const { rows } = await pool.query<{ id: number; name: string; role: SessionPayload["role"]; session_version: number }>(
    `UPDATE users SET session_version = COALESCE(session_version, 0) + 1${extra}
      WHERE id = $1 RETURNING id, name, role, session_version`,
    [session.userId, ...(set.params ?? [])]
  );
  const u = rows[0];
  if (!u) return false;
  await createSessionCookie({ userId: u.id, name: u.name, role: u.role, sessionVersion: u.session_version });
  return true;
}
