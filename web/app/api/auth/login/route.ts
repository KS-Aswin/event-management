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
// Sign-in limits (QA-005, reworked for QA-082 so a griefer who knows an
// email can't keep its owner out):
// - per client IP, any email: PER_IP_MAX per 15 min.
// - per (email, IP): PER_PAIR_MAX failed attempts per 15 min. One IP can't
//   guess one account more than that, and its lock is its own.
// - per email, from any IP: after PER_EMAIL_SOFT attempts in 15 min the
//   account is "soft locked": an IP that already made SOFT_LOCK_TRIES_PER_IP
//   attempts on it in this window is refused, but a device that hasn't
//   (normally the owner's) still gets to try (and to fix one typo), so the
//   right password still signs in. A distributed guesser then gets two
//   tries per fresh IP...
// - ...and at most PER_EMAIL_HARD failures per hour in total, after which
//   the account is hard locked for everyone (which takes ~45 distinct IPs
//   in an hour to trigger, not one script).
const PER_PAIR_MAX = 5;
const PER_EMAIL_SOFT = 10;
const SOFT_LOCK_TRIES_PER_IP = 2;
const HARD_WINDOW_MS = 60 * 60 * 1000;
const PER_EMAIL_HARD = 100;
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

  const ip = clientIp(request.headers);
  const normalisedEmail = email.trim().toLowerCase();
  const emailKey = `login:fail:${normalisedEmail}`;
  const pairKey = `login:pair:${normalisedEmail}:${ip}`;
  const hardKey = `login:hard:${normalisedEmail}`;
  const ipHit = await rateLimitHit(`login:ip:${ip}`, PER_IP_MAX, WINDOW_MS);
  if (!ipHit.ok) return tooManyRequests(ipHit.retryAfter);
  // Charge the attempt BEFORE checking the password (atomic increments), so
  // a burst of parallel guesses can't all pass a read-only check first. A
  // successful sign-in clears the 15-minute counts again below.
  const pair = await rateLimitHit(pairKey, PER_PAIR_MAX, WINDOW_MS);
  if (!pair.ok) return tooManyRequests(pair.retryAfter);
  const hard = await rateLimitPeek(hardKey, PER_EMAIL_HARD, HARD_WINDOW_MS);
  if (!hard.ok) return tooManyRequests(hard.retryAfter);
  const account = await rateLimitHit(emailKey, PER_EMAIL_SOFT, WINDOW_MS);
  // Soft lock: only an IP that has barely tried this account in the window.
  if (!account.ok && (pair.hits ?? PER_PAIR_MAX) > SOFT_LOCK_TRIES_PER_IP) {
    return tooManyRequests(account.retryAfter);
  }

  const user = await findUserByEmail(email);
  // Deliberately generic error for both "no such user" and "wrong password" —
  // distinguishing them lets an attacker enumerate registered emails.
  const genericError = () => NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });

  const valid = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, DUMMY_HASH);
  if (!user || !valid) {
    await rateLimitHit(hardKey, PER_EMAIL_HARD, HARD_WINDOW_MS);
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

  await Promise.all([rateLimitReset(emailKey), rateLimitReset(pairKey)]);
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
