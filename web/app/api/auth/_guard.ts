import { NextResponse } from "next/server";

// CSRF hardening for the session-setting auth endpoints (login, register,
// logout). SameSite=Lax cookies do not protect these, because a cross-site
// top-level form POST can still set or clear the session cookie. A plain HTML
// form cannot send Content-Type: application/json, and browsers always send
// an Origin header on cross-site POSTs, so these two checks block it.
// Returns an error response to send, or null when the request is acceptable.
export function rejectCrossSite(request: Request, { requireJson = true } = {}) {
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (!originHost || !host || originHost !== host) {
      return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
    }
  }

  if (requireJson) {
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      return NextResponse.json(
        { error: "Content-Type must be application/json." },
        { status: 415 }
      );
    }
  }
  return null;
}

/** Friendly 429 with Retry-After, in the { error } shape the forms display. */
export function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many attempts. Please wait a few minutes and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}
