import { NextResponse } from "next/server";
import { createUser, findUserByEmail } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, email, password, role } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length < 2) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (typeof email !== "string" || !isValidEmail(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }
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
  const user = await createUser({ name: name.trim(), email, passwordHash, role });

  await createSessionCookie({ userId: user.id, name: user.name, role: user.role });

  return NextResponse.json(
    { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    { status: 201 }
  );
}
