import { NextResponse } from "next/server";
import { createSessionCookie, destroySessionCookie } from "@/lib/session";
import { updateUser, findUserByEmail, findUserById } from "@/lib/db";
import { getLiveSession, sessionVersionOf } from "../_lib/auth";
import { requireCurrentPassword } from "./_security";
import { isValidEmail, LIMITS } from "../_lib/validation";
import { rateLimitHit } from "@/lib/rate-limit";
import { tooManyRequests } from "../auth/_guard";

// Email-change attempts per account per 15 min (QA-092), the same budget
// as sign-up per IP (app/api/auth/register).
const EMAIL_CHANGE_MAX = 10;
const EMAIL_CHANGE_WINDOW_MS = 15 * 60 * 1000;

function fieldError(field: string, error: string) {
  return NextResponse.json({ field, error }, { status: 400 });
}

export async function PATCH(request: Request) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, email, emailNotifications, smsNotifications, currentPassword } = (body ?? {}) as Record<
    string,
    unknown
  >;

  // A field that is sent must be valid; silently ignoring it would show
  // "Settings saved" while nothing changed.
  let cleanName: string | undefined;
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2) {
      return fieldError("name", "Please enter your name.");
    }
    if (name.trim().length > LIMITS.name) {
      return fieldError("name", `Name must be ${LIMITS.name} characters or fewer.`);
    }
    cleanName = name.trim().replace(/\s+/g, " ");
  }

  let cleanEmail: string | undefined;
  if (email !== undefined) {
    if (typeof email !== "string" || !isValidEmail(email.trim().toLowerCase())) {
      return fieldError("email", "Please enter a valid email address.");
    }
    cleanEmail = email.trim().toLowerCase();
  }

  if (emailNotifications !== undefined && typeof emailNotifications !== "boolean") {
    return fieldError("emailNotifications", "Email notifications must be true or false.");
  }
  if (smsNotifications !== undefined && typeof smsNotifications !== "boolean") {
    return fieldError("smsNotifications", "SMS notifications must be true or false.");
  }

  const before = await findUserById(session.userId);
  // Changing the sign-in email needs the current password (QA-080): reset
  // links go to that address, so a borrowed or forged session must not be
  // able to move it.
  //
  // QA-092: the password comes BEFORE the "already in use" check, and email
  // changes are rate-limited per account like sign-up is per IP, so this
  // route can't be used to test which emails have a Vela account.
  if (cleanEmail !== undefined && cleanEmail !== before?.email.toLowerCase()) {
    const limit = await rateLimitHit(`account:email-change:${session.userId}`, EMAIL_CHANGE_MAX, EMAIL_CHANGE_WINDOW_MS);
    if (!limit.ok) return tooManyRequests(limit.retryAfter);
    const checked = await requireCurrentPassword(session.userId, currentPassword);
    if (checked instanceof Response) return checked;
    const existing = await findUserByEmail(cleanEmail);
    if (existing && existing.id !== session.userId) {
      return NextResponse.json(
        { field: "email", error: "That email is already in use by another account." },
        { status: 409 }
      );
    }
  }
  let updated;
  try {
    updated = await updateUser(session.userId, {
      name: cleanName,
      email: cleanEmail,
      emailNotifications: emailNotifications as boolean | undefined,
      smsNotifications: smsNotifications as boolean | undefined,
    });
  } catch (err) {
    // Lost a race with another account taking the same email.
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return NextResponse.json(
        { field: "email", error: "That email is already in use by another account." },
        { status: 409 }
      );
    }
    throw err;
  }
  if (!updated) {
    await destroySessionCookie();
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Refresh the session cookie only when the name (shown in the header) changed.
  if (!before || before.name !== updated.name) {
    await createSessionCookie({
      userId: updated.id,
      name: updated.name,
      role: updated.role,
      sessionVersion: sessionVersionOf(updated),
    });
  }

  return NextResponse.json({
    user: {
      name: updated.name,
      email: updated.email,
      emailNotifications: updated.email_notifications,
      smsNotifications: updated.sms_notifications,
    },
  });
}
