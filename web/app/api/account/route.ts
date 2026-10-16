import { NextResponse } from "next/server";
import { getSession, createSessionCookie, destroySessionCookie } from "@/lib/session";
import { updateUser, findUserByEmail, findUserById, deleteUserAccount } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createAuthToken } from "@/lib/tokens";
import { appUrl, sendEmail } from "@/lib/email";
import { isValidEmail } from "@/lib/validate";

export async function PATCH(request: Request) {
  const session = await getSession();
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

  if (typeof name === "string" && name.trim() && (name.trim().length < 2 || name.trim().length > 100)) {
    return NextResponse.json({ error: "Name must be between 2 and 100 characters." }, { status: 400 });
  }

  const newEmail = typeof email === "string" && email.trim() ? email.trim() : undefined;
  if (newEmail) {
    if (!isValidEmail(newEmail)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    const existing = await findUserByEmail(newEmail);
    if (existing && existing.id !== session.userId) {
      return NextResponse.json(
        { error: "That email is already in use by another account." },
        { status: 409 }
      );
    }
  }

  const before = await findUserById(session.userId);
  if (!before) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const updated = await updateUser(session.userId, {
    name: typeof name === "string" && name.trim() ? name.trim() : undefined,
    email: newEmail,
    emailNotifications: typeof emailNotifications === "boolean" ? emailNotifications : undefined,
    smsNotifications: typeof smsNotifications === "boolean" ? smsNotifications : undefined,
  });

  // A changed email must be confirmed again.
  if (newEmail && updated.email !== before.email) {
    try {
      const token = await createAuthToken(updated.id, "verify");
      await sendEmail({
        to: updated.email,
        subject: "Confirm your new email for Vela",
        text: `Confirm your new email address:\n${appUrl()}/api/auth/verify?token=${token}`,
      });
    } catch (err) {
      console.error("[account] could not send verification email:", err);
    }
  }

  // Refresh the session cookie so the header shows the new name immediately.
  await createSessionCookie({ userId: updated.id, name: updated.name, role: updated.role });

  return NextResponse.json({
    user: {
      name: updated.name,
      email: updated.email,
      emailVerified: updated.email_verified,
      emailNotifications: updated.email_notifications,
      smsNotifications: updated.sms_notifications,
    },
  });
}

// Permanently deletes the account (and the vendor listing it owns). The
// password must be re-entered so a stolen session can't wipe an account.
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.role === "admin") {
    return NextResponse.json(
      { error: "Admin accounts can't be deleted from the app." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { password } = (body ?? {}) as Record<string, unknown>;
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Please enter your password to confirm." }, { status: 400 });
  }

  const user = await findUserById(session.userId);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 403 });
  }

  await deleteUserAccount(user.id);
  await destroySessionCookie();
  return NextResponse.json({ ok: true });
}
