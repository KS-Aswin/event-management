import { NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  // Deliberately generic error for both "no such user" and "wrong password" —
  // distinguishing them lets an attacker enumerate registered emails.
  const genericError = NextResponse.json(
    { error: "Incorrect email or password." },
    { status: 401 }
  );

  if (!user) return genericError;

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return genericError;

  await createSessionCookie({ userId: user.id, name: user.name, role: user.role });

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}
