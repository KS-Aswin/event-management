import { NextResponse } from "next/server";
import { markEmailVerified } from "@/lib/db";
import { consumeAuthToken } from "@/lib/tokens";

// Target of the link in the verification email.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const userId = token ? await consumeAuthToken(token, "verify") : null;

  if (userId === null) {
    return NextResponse.redirect(new URL("/dashboard?verified=0", request.url));
  }
  await markEmailVerified(userId);
  return NextResponse.redirect(new URL("/dashboard?verified=1", request.url));
}
