import { NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/db";
import { createAuthToken } from "@/lib/tokens";
import { appUrl, sendEmail } from "@/lib/email";
import { clientIp, rateLimit } from "@/lib/ratelimit";

// Always answers the same way whether or not the email is registered, so this
// endpoint can't be used to find out who has an account.
export async function POST(request: Request) {
  const limited = rateLimit(`forgot:${clientIp(request)}`, 5, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { email } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Please enter your email." }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  if (user) {
    try {
      const token = await createAuthToken(user.id, "reset");
      await sendEmail({
        to: user.email,
        subject: "Reset your Vela password",
        text: `Someone asked to reset the password for your Vela account.\n\nChoose a new password here (valid for 1 hour):\n${appUrl()}/reset-password?token=${token}\n\nIf this wasn't you, you can ignore this email.`,
      });
    } catch (err) {
      console.error("[forgot] could not create/send reset token:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
