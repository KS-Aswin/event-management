import { NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { rejectCrossSite, tooManyRequests } from "../_guard";
import { landingFor, sessionVersionOf } from "../../_lib/auth";
import { safeNext } from "@/app/login/safe-next";

// Compared against when the email is unknown, so "no such user" takes as long
// as "wrong password" and response timing doesn't reveal registered emails.
const DUMMY_HASH = "$2b$10$5tZ8xlHVJct4ThZaoo0S.OuNhbH/Q2sjjxGiD6fGUSzDpK/gTmwvq";

const WINDOW_MS = 15 * 60 * 1000;
const PER_EMAIL_MAX = 10; // attempts per email per IP per 15 min
const PER_IP_MAX = process.env.NODE_ENV === "production" ? 50 : 500;

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, password, next } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const ip = clientIp(request.headers);
  if (
    !checkRateLimit(`login:ip:${ip}`, PER_IP_MAX, WINDOW_MS) ||
    !checkRateLimit(`login:email:${ip}:${email.trim().toLowerCase()}`, PER_EMAIL_MAX, WINDOW_MS)
  ) {
    return tooManyRequests(WINDOW_MS / 1000);
  }

  const user = await findUserByEmail(email);
  // Deliberately generic error for both "no such user" and "wrong password" —
  // distinguishing them lets an attacker enumerate registered emails.
  const genericError = NextResponse.json(
    { error: "Incorrect email or password." },
    { status: 401 }
  );

  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    return genericError;
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return genericError;

  // users.status arrives with migration 004; absent before it.
  const status = (user as { status?: string | null }).status;
  if (status === "suspended") {
    return NextResponse.json(
      { error: "This account is suspended. Contact support if you think this is a mistake." },
      { status: 403 }
    );
  }
  if (status === "deleted") return genericError;

  await createSessionCookie({
    userId: user.id,
    name: user.name,
    role: user.role,
    sessionVersion: sessionVersionOf(user),
  });

  // Role-based landing (PRODUCT_PLAN 2.6); a next into another role's area is ignored.
  const redirectTo = await landingFor(user, safeNext(next, ""));

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    redirectTo,
  });
}
