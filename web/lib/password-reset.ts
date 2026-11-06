// One-time password reset links (QA-007).
//
// There is no email provider yet (free tools only), so a user who forgot
// their password asks support; an admin checks who they are and creates a
// link from /admin/users/<id>, then passes it on (WhatsApp, phone, email from
// their own mailbox). Once an email provider is set up, a self-service
// "email me a link" form can call createResetLink() directly.
//
// - The token is 32 random bytes; only its sha256 is stored, so a database
//   leak doesn't hand out working links. The link is shown once.
// - A link expires after RESET_TTL_HOURS and works once. Creating a new link
//   cancels older unused ones for that user.
// - Using it sets the new password, bumps session_version (every device is
//   signed out) and is audit-logged with the admin who created the link.

import { createHash, randomBytes } from "crypto";
import { pool } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { audit } from "@/lib/admin/audit";
import { HttpError, withTransaction } from "@/lib/admin/tx";

export const RESET_TTL_HOURS = 24;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isResetToken(raw: unknown): raw is string {
  return typeof raw === "string" && TOKEN_RE.test(raw);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ResetLink {
  token: string;
  path: string;
  expiresAt: string;
}

/**
 * Admin action: a new reset link for `targetId`. Refuses deleted accounts and
 * admin accounts (one admin must not be able to take over another's login).
 */
export async function createResetLink(opts: {
  actorId: number;
  targetId: number;
  reason: string | null;
  ip: string | null;
}): Promise<ResetLink> {
  const token = randomBytes(32).toString("base64url");
  return withTransaction(async (client) => {
    const u = await client.query<{ id: number; role: string; status: string | null }>(
      "SELECT id, role::text AS role, status FROM users WHERE id = $1 FOR UPDATE",
      [opts.targetId]
    );
    const user = u.rows[0];
    if (!user) throw new HttpError(404, "User not found.");
    if (user.status === "deleted") throw new HttpError(409, "This account was deleted.", "DELETED");
    if (user.role === "admin") {
      throw new HttpError(409, "Admin passwords can't be reset from here. The site owner resets them on the server.", "ADMIN");
    }
    if (opts.targetId === opts.actorId) throw new HttpError(409, "You can't create a reset link for yourself.", "SELF");

    const cancelled = await client.query(
      "UPDATE password_reset_tokens SET expires_at = now() WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()",
      [opts.targetId]
    );
    const r = await client.query<{ id: string; expires_at: Date }>(
      `INSERT INTO password_reset_tokens (user_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4)) RETURNING id, expires_at`,
      [opts.targetId, hashToken(token), opts.actorId, RESET_TTL_HOURS]
    );
    const expiresAt = r.rows[0].expires_at.toISOString();
    await audit(client, {
      actorId: opts.actorId,
      action: "user.password_reset_link",
      entityType: "user",
      entityId: opts.targetId,
      // Never the token itself.
      after: { resetId: Number(r.rows[0].id), expiresAt, cancelledOlder: cancelled.rowCount ?? 0 },
      reason: opts.reason,
      ip: opts.ip,
    });
    return { token, path: `/reset-password?token=${token}`, expiresAt };
  });
}

export type ResetCheck = { ok: true; name: string } | { ok: false };

/** Whether a reset token can still be used (for the page), without using it. */
export async function checkResetToken(token: string): Promise<ResetCheck> {
  if (!isResetToken(token)) return { ok: false };

  const { rows } = await pool.query<{ name: string }>(
    `SELECT u.name FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
        AND COALESCE(u.status, 'active') <> 'deleted'`,
    [hashToken(token)]
  );
  return rows[0] ? { ok: true, name: rows[0].name } : { ok: false };
}

/**
 * Uses a reset token: sets the new password (already validated by the
 * caller), signs the user out everywhere and burns the token. Returns the
 * user's email (to prefill sign-in), or null when the token is unknown,
 * used or expired.
 */
export async function consumeResetToken(
  token: string,
  newPassword: string,
  ip: string | null
): Promise<{ email: string } | null> {
  if (!isResetToken(token)) return null;
  const passwordHash = await hashPassword(newPassword);
  return withTransaction(async (client) => {
    const t = await client.query<{ id: string; user_id: number; created_by: number | null }>(
      `SELECT id, user_id, created_by FROM password_reset_tokens
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [hashToken(token)]
    );
    const row = t.rows[0];
    if (!row) return null;
    const u = await client.query<{ email: string }>(
      `UPDATE users SET password_hash = $2, session_version = session_version + 1
        WHERE id = $1 AND COALESCE(status, 'active') <> 'deleted' RETURNING email`,
      [row.user_id, passwordHash]
    );
    if (!u.rows[0]) return null;
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
    // Any other open links for this user die too.
    await client.query(
      "UPDATE password_reset_tokens SET expires_at = now() WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()",
      [row.user_id]
    );
    if (row.created_by) {
      await audit(client, {
        actorId: row.created_by,
        action: "user.password_reset_used",
        entityType: "user",
        entityId: row.user_id,
        // actor_id is the admin who created the link (audit rows need an
        // admin actor); the account holder did the change (QA-076).
        after: { resetId: Number(row.id), changedBy: "account holder", linkCreatedBy: row.created_by },
        reason: "The account holder changed their password with a reset link",
        ip,
      });
    }
    return { email: u.rows[0].email };
  });
}
