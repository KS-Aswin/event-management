import { NextResponse } from "next/server";
import { clientIp, rateLimitHit, rateLimitReset } from "@/lib/rate-limit";
import { consumeResetToken, isResetToken } from "@/lib/password-reset";
import { byteLength, MAX_PASSWORD_BYTES, rejectCrossSite, tooManyRequests } from "../_guard";

const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_MAX = process.env.NODE_ENV === "production" ? 20 : 200;
const NO_STORE = { "Cache-Control": "private, no-store" };

// POST /api/auth/reset-password { token, password } (QA-007): sets a new
// password with a one-time link from an admin. Signs the user out on every
// device; they sign in again with the new password.
// 200 { ok, email } | 400 bad password / invalid or used or expired link | 429
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const ip = clientIp(request.headers);
  const limit = await rateLimitHit(`reset:ip:${ip}`, PER_IP_MAX, WINDOW_MS);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }
  const { token, password } = body;
  const invalidLink = NextResponse.json(
    { error: "This reset link is invalid, already used or expired. Ask support for a new one.", code: "INVALID_LINK" },
    { status: 400, headers: NO_STORE }
  );
  if (!isResetToken(token)) return invalidLink;
  if (typeof password !== "string" || password.trim().length < 8) {
    return NextResponse.json(
      { field: "password", error: "Password must be at least 8 characters." },
      { status: 400, headers: NO_STORE }
    );
  }
  if (byteLength(password) > MAX_PASSWORD_BYTES) {
    return NextResponse.json(
      { field: "password", error: `Password is too long. Please use ${MAX_PASSWORD_BYTES} characters or fewer.` },
      { status: 400, headers: NO_STORE }
    );
  }
  const done = await consumeResetToken(token, password, ip === "unknown" ? null : ip);
  if (!done) return invalidLink;
  // A fresh start for sign-in on that account.
  await rateLimitReset(`login:fail:${done.email.trim().toLowerCase()}`);
  return NextResponse.json({ ok: true, email: done.email }, { headers: NO_STORE });
}
