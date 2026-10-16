import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { findUserById } from "@/lib/db";
import { createAuthToken } from "@/lib/tokens";
import { appUrl, sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/ratelimit";

// "Resend verification email" button in Settings.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const limited = rateLimit(`verify-resend:${session.userId}`, 3, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Please wait before requesting another email." }, { status: 429 });
  }

  const user = await findUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  if (user.email_verified) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  const token = await createAuthToken(user.id, "verify");
  await sendEmail({
    to: user.email,
    subject: "Confirm your email for Vela",
    text: `Confirm your email address:\n${appUrl()}/api/auth/verify?token=${token}\n\nThis link works for 24 hours.`,
  });
  return NextResponse.json({ ok: true });
}
