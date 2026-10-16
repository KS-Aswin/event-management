import { NextResponse } from "next/server";
import { createUser, findUserByEmail } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";
import { createAuthToken } from "@/lib/tokens";
import { appUrl, sendEmail } from "@/lib/email";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { isValidEmail } from "@/lib/validate";

export async function POST(request: Request) {
  const limited = rateLimit(`register:${clientIp(request)}`, 10, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many sign-up attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, email, password, role } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (typeof email !== "string" || !isValidEmail(email.trim())) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  // bcrypt only uses the first 72 bytes, so longer passwords add nothing.
  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    return NextResponse.json(
      { error: "Password must be between 8 and 72 characters." },
      { status: 400 }
    );
  }
  // Admins are never created through signup (see db/make-admin.mjs).
  if (role !== "customer" && role !== "vendor") {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ name: name.trim(), email: email.trim(), passwordHash, role });

  await createSessionCookie({ userId: user.id, name: user.name, role: user.role });

  // Ask the new user to confirm their email. Sign-in isn't blocked on this.
  try {
    const token = await createAuthToken(user.id, "verify");
    await sendEmail({
      to: user.email,
      subject: "Confirm your email for Vela",
      text: `Welcome to Vela, ${user.name}!\n\nConfirm your email address:\n${appUrl()}/api/auth/verify?token=${token}\n\nThis link works for 24 hours.`,
    });
  } catch (err) {
    console.error("[register] could not send verification email:", err);
  }

  return NextResponse.json(
    { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    { status: 201 }
  );
}
