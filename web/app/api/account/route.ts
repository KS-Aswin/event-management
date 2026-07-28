import { NextResponse } from "next/server";
import { getSession, createSessionCookie } from "@/lib/session";
import { updateUser, findUserByEmail } from "@/lib/db";

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

  if (typeof email === "string" && email.trim()) {
    const existing = await findUserByEmail(email);
    if (existing && existing.id !== session.userId) {
      return NextResponse.json(
        { error: "That email is already in use by another account." },
        { status: 409 }
      );
    }
  }

  const updated = await updateUser(session.userId, {
    name: typeof name === "string" && name.trim() ? name.trim() : undefined,
    email: typeof email === "string" && email.trim() ? email.trim() : undefined,
    emailNotifications: typeof emailNotifications === "boolean" ? emailNotifications : undefined,
    smsNotifications: typeof smsNotifications === "boolean" ? smsNotifications : undefined,
  });

  // Refresh the session cookie so the header shows the new name immediately.
  await createSessionCookie({ userId: updated.id, name: updated.name, role: updated.role });

  return NextResponse.json({
    user: {
      name: updated.name,
      email: updated.email,
      emailNotifications: updated.email_notifications,
      smsNotifications: updated.sms_notifications,
    },
  });
}
