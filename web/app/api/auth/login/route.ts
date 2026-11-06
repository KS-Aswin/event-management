import { NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";
import { clientIp, rateLimitHit, rateLimitPeek, rateLimitReset } from "@/lib/rate-limit";
import { MAX_LOGIN_PASSWORD_LENGTH, recordSignIn, rejectCrossSite, tooManyRequests } from "../_guard";
import { landingFor, sessionVersionOf } from "../../_lib/auth";
import { safeNext } from "@/app/login/safe-next";
import { guestTokenFromPath, linkGuestEnquiryByToken } from "@/lib/enquiry-tracking";
import { suspensionMessage } from "@/lib/suspension";

// Compared against when the email is unknown, so "no such user" takes as long
// as "wrong password" and response timing doesn't reveal registered emails.
const DUMMY_HASH = "$2b$10$5tZ8xlHVJct4ThZaoo0S.OuNhbH/Q2sjjxGiD6fGUSzDpK/gTmwvq";

const WINDOW_MS = 15 * 60 * 1000;
// Failed passwords per ACCOUNT per 15 min, from any IP (QA-005): rotating
// IPs can't be used to keep guessing one account's password.
const PER_EMAIL_MAX = 10;
// Attempts per client IP per 15 min (any email).
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

  const { email, password, next, enquiryToken } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (email.length > 254 || password.length > MAX_LOGIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const emailKey = `login:fail:${email.trim().toLowerCase()}`;
  const ipHit = await rateLimitHit(`login:ip:${clientIp(request.headers)}`, PER_IP_MAX, WINDOW_MS);
  if (!ipHit.ok) return tooManyRequests(ipHit.retryAfter);
  const lock = await rateLimitPeek(emailKey, PER_EMAIL_MAX, WINDOW_MS);
  if (!lock.ok) return tooManyRequests(lock.retryAfter);

  const user = await findUserByEmail(email);
  // Deliberately generic error for both "no such user" and "wrong password" —
  // distinguishing them lets an attacker enumerate registered emails.
  const genericError = () => NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });

  const valid = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, DUMMY_HASH);
  if (!user || !valid) {
    await rateLimitHit(emailKey, PER_EMAIL_MAX, WINDOW_MS);
    return genericError();
  }

  // users.status arrives with migration 004; absent before it.
  const live = user as { status?: string | null; suspended_reason?: string | null };
  if (live.status === "suspended") {
    // The password was right, so this is the account holder: tell them why
    // (QA-031; the admin dialogs say the reason is shown to the user).
    return NextResponse.json(
      { error: suspensionMessage(live.suspended_reason), code: "SUSPENDED" },
      { status: 403 }
    );
  }
  if (live.status === "deleted") return genericError();

  await rateLimitReset(emailKey);
  await createSessionCookie({
    userId: user.id,
    name: user.name,
    role: user.role,
    sessionVersion: sessionVersionOf(user),
  });
  await recordSignIn(user.id);

  // QA-003: a guest enquiry joins the account only when the guest brings its
  // private tracking token (never by matching the contact email).
  const cleanNext = safeNext(next, "");
  const linkedId = await linkGuestEnquiryByToken(user, enquiryToken ?? guestTokenFromPath(cleanNext));

  // Role-based landing (PRODUCT_PLAN 2.6); a next into another role's area is ignored.
  const redirectTo =
    linkedId && (!cleanNext || cleanNext === "/my/enquiries" || guestTokenFromPath(cleanNext))
      ? `/my/enquiries/${linkedId}`
      : await landingFor(user, cleanNext);

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    redirectTo,
    ...(linkedId ? { linkedEnquiryId: linkedId } : {}),
  });
}
