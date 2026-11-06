import { NextResponse } from "next/server";
import { createUser, findUserByEmail } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";
import { clientIp, rateLimitHit } from "@/lib/rate-limit";
import { byteLength, MAX_PASSWORD_BYTES, recordSignIn, rejectCrossSite, tooManyRequests } from "../_guard";
import { landingFor, sessionVersionOf } from "../../_lib/auth";
import { LIMITS } from "../../_lib/validation";
import { safeNext } from "@/app/login/safe-next";
import { guestTokenFromPath, linkGuestEnquiryByToken } from "@/lib/enquiry-tracking";

const WINDOW_MS = 60 * 60 * 1000;
// Registrations per IP per hour (shared across server instances, QA-005).
// Also caps how cheaply the 409 "email already exists" response can be used
// to enumerate accounts.
const PER_IP_MAX = process.env.NODE_ENV === "production" ? 10 : 200;

function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;

  const limit = await rateLimitHit(`register:ip:${clientIp(request.headers)}`, PER_IP_MAX, WINDOW_MS);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, email, password, role, next, enquiryToken } = (body ?? {}) as Record<string, unknown>;

  // Same rules as Settings (PATCH /api/account): 2..80 characters. A huge
  // name used to overflow the session cookie and lock the account (QA-006).
  const cleanName = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (cleanName.length < 2) {
    return NextResponse.json({ field: "name", error: "Please enter your name." }, { status: 400 });
  }
  if (cleanName.length > LIMITS.name) {
    return NextResponse.json(
      { field: "name", error: `Name must be ${LIMITS.name} characters or fewer.` },
      { status: 400 }
    );
  }
  if (typeof email !== "string" || !isValidEmail(email.trim())) {
    return NextResponse.json({ field: "email", error: "Please enter a valid email address." }, { status: 400 });
  }
  if (typeof password !== "string" || password.trim().length < 8) {
    return NextResponse.json(
      { field: "password", error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }
  if (byteLength(password) > MAX_PASSWORD_BYTES) {
    return NextResponse.json(
      { field: "password", error: `Password is too long. Please use ${MAX_PASSWORD_BYTES} characters or fewer.` },
      { status: 400 }
    );
  }
  if (role !== "customer" && role !== "vendor") {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return NextResponse.json(
      { field: "email", error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ name: cleanName, email: email.trim(), passwordHash, role });

  await createSessionCookie({
    userId: user.id,
    name: user.name,
    role: user.role,
    sessionVersion: sessionVersionOf(user),
  });
  await recordSignIn(user.id);

  // QA-003: a guest enquiry joins the new account only when the guest brings
  // its private tracking token. Registering with someone's email no longer
  // pulls in their enquiries (the email isn't verified).
  const cleanNext = safeNext(next, "");
  const linkedId = await linkGuestEnquiryByToken(user, enquiryToken ?? guestTokenFromPath(cleanNext));

  // New vendors have no listing yet, so this sends them to /vendor/onboarding.
  const redirectTo =
    linkedId && (!cleanNext || cleanNext === "/my/enquiries" || guestTokenFromPath(cleanNext))
      ? `/my/enquiries/${linkedId}`
      : await landingFor(user, cleanNext);

  return NextResponse.json(
    {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      redirectTo,
      ...(linkedId ? { linkedEnquiryId: linkedId } : {}),
    },
    { status: 201 }
  );
}
