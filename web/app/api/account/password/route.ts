import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { findUserById, updateUserPassword } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
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
  const { currentPassword, newPassword } = (body ?? {}) as Record<string, unknown>;

  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "Both passwords are required." }, { status: 400 });
  }
  if (newPassword.length < 8 || newPassword.length > 72) {
    return NextResponse.json(
      { error: "New password must be between 8 and 72 characters." },
      { status: 400 }
    );
  }

  const user = await findUserById(session.userId);
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }

  await updateUserPassword(user.id, await hashPassword(newPassword));
  return NextResponse.json({ ok: true });
}
