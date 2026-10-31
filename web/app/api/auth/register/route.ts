import { NextResponse } from "next/server";
import { createUser, findUserByEmail } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { rejectCrossSite, tooManyRequests } from "../_guard";
import { landingFor, sessionVersionOf } from "../../_lib/auth";
import { safeNext } from "@/app/login/safe-next";

const WINDOW_MS = 60 * 60 * 1000;
// Registrations per IP per hour. Also caps how cheaply the 409 "email already
// exists" response can be used to enumerate accounts.
const PER_IP_MAX = process.env.NODE_ENV === "production" ? 10 : 200;

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  if (!checkRateLimit(`register:ip:${clientIp(request.headers)}`, PER_IP_MAX, WINDOW_MS)) {
    return tooManyRequests(WINDOW_MS / 1000);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, email, password, role, next } = (body ?? {}) as Record<string, unknown>;

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

  await createSessionCookie({
    userId: user.id,
    name: user.name,
    role: user.role,
    sessionVersion: sessionVersionOf(user),
  });

  // New vendors have no listing yet, so this sends them to /vendor/onboarding.
  const redirectTo = await landingFor(user, safeNext(next, ""));

  return NextResponse.json(
    { user: { id: user.id, name: user.name, email: user.email, role: user.role }, redirectTo },
    { status: 201 }
  );
}
