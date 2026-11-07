import { NextResponse } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/password";
import { pool } from "@/lib/db";
import { getLiveSession } from "../../_lib/auth";
import { byteLength, MAX_PASSWORD_BYTES } from "../../auth/_guard";
import { endOtherSessions, requireCurrentPassword } from "../_security";

const NO_STORE = { "Cache-Control": "private, no-store" };

// POST /api/account/password { currentPassword, newPassword } (QA-059):
// a signed-in user changes their password. The current password is required
// (an unattended or stolen session can't lock the owner out). Every other
// device is signed out; this one stays signed in.
// 200 { ok } | 400 { field, error } | 401 | 429
export async function POST(request: Request) {
  const session = await getLiveSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE });

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }
  const { currentPassword, newPassword } = body;

  if (typeof newPassword !== "string" || newPassword.trim().length < 8) {
    return NextResponse.json(
      { field: "newPassword", error: "New password must be at least 8 characters." },
      { status: 400, headers: NO_STORE }
    );
  }
  if (byteLength(newPassword) > MAX_PASSWORD_BYTES) {
    return NextResponse.json(
      { field: "newPassword", error: `New password is too long. Please use ${MAX_PASSWORD_BYTES} characters or fewer.` },
      { status: 400, headers: NO_STORE }
    );
  }

  const user = await requireCurrentPassword(session.userId, currentPassword);
  if (user instanceof Response) return user;

  if (await verifyPassword(newPassword, user.password_hash)) {
    return NextResponse.json(
      { field: "newPassword", error: "Choose a password different from your current one." },
      { status: 400, headers: NO_STORE }
    );
  }

  const hash = await hashPassword(newPassword);
  const ok = await endOtherSessions(session, { sql: "password_hash = $2", params: [hash] });
  if (!ok) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE });
  // A reset link sent before the change must not undo it (same rule as
  // using a reset link, lib/password-reset.ts).
  await pool
    .query(
      "UPDATE password_reset_tokens SET expires_at = now() WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()",
      [session.userId]
    )
    .catch((err) => console.error("password change: could not expire reset links", err));
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
