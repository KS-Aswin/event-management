import { NextResponse } from "next/server";
import { markEmailVerified, updateUserPassword } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { consumeAuthToken } from "@/lib/tokens";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export async function POST(request: Request) {
  const limited = rateLimit(`reset:${clientIp(request)}`, 10, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { token, password } = (body ?? {}) as Record<string, unknown>;

  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    return NextResponse.json(
      { error: "Password must be between 8 and 72 characters." },
      { status: 400 }
    );
  }
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  const userId = await consumeAuthToken(token, "reset");
  if (userId === null) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  await updateUserPassword(userId, await hashPassword(password));
  // They proved they control the inbox, so the email counts as verified.
  await markEmailVerified(userId);

  return NextResponse.json({ ok: true });
}
