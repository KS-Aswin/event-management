import { NextResponse } from "next/server";
import { createSessionCookie, destroySessionCookie } from "@/lib/session";
import { updateUser, findUserByEmail, findUserById } from "@/lib/db";
import { getLiveSession } from "../_lib/auth";
import { isValidEmail, LIMITS } from "../_lib/validation";

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

  const { name, email, emailNotifications, smsNotifications } = (body ?? {}) as Record<
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
    const existing = await findUserByEmail(cleanEmail);
    if (existing && existing.id !== session.userId) {
      return NextResponse.json(
        { field: "email", error: "That email is already in use by another account." },
        { status: 409 }
      );
    }
  }

  if (emailNotifications !== undefined && typeof emailNotifications !== "boolean") {
    return fieldError("emailNotifications", "Email notifications must be true or false.");
  }
  if (smsNotifications !== undefined && typeof smsNotifications !== "boolean") {
    return fieldError("smsNotifications", "SMS notifications must be true or false.");
  }

  const before = await findUserById(session.userId);
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
    await createSessionCookie({ userId: updated.id, name: updated.name, role: updated.role });
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
