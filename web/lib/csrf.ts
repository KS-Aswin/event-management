import { NextResponse } from "next/server";

// Cross-site request checks (CSRF defence in depth on top of the SameSite=Lax
// session cookie). No imports beyond next/server: proxy.ts and route
// handlers both use it.
//
// - Origin: browsers send it on every cross-site POST/PUT/PATCH/DELETE, so
//   a request whose Origin isn't this host is refused (403). Sec-Fetch-Site
//   "cross-site" is refused too, for the rare browser that omits Origin.
// - Content type: a plain HTML form (the classic CSRF vector) can only send
//   text/plain, application/x-www-form-urlencoded or multipart/form-data
//   without a CORS preflight. Our JSON APIs refuse the first two (415);
//   multipart is allowed for uploads and is covered by the Origin check.

export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The host this request was sent to (the forwarded host behind a proxy). */
function requestHost(request: Request): string | null {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host");
}

/** 403 when the request clearly comes from another site, else null. */
export function crossOriginBlock(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const host = requestHost(request);
    if (!originHost || !host || originHost !== host) {
      return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
    }
  } else if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  return null;
}

/** Media type of the request body, lowercased, without parameters ("" when absent). */
export function mediaType(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

const FORM_TYPES = new Set(["text/plain", "application/x-www-form-urlencoded"]);

/**
 * Central check for cookie-authenticated mutating /api requests (QA-080),
 * run by proxy.ts: same-origin only, and never a form-shaped body.
 */
export function apiCrossSiteBlock(request: Request, { checkBodyType }: { checkBodyType: boolean }): NextResponse | null {
  const blocked = crossOriginBlock(request);
  if (blocked) return blocked;
  if (checkBodyType && FORM_TYPES.has(mediaType(request))) {
    return NextResponse.json(
      { error: "Content-Type must be application/json." },
      { status: 415 }
    );
  }
  return null;
}

/**
 * Stricter check for the session-setting auth endpoints (login, register,
 * logout...): same origin, and (unless requireJson is false) a JSON body.
 * Returns an error response to send, or null when the request is acceptable.
 */
export function rejectCrossSite(request: Request, { requireJson = true } = {}): NextResponse | null {
  const blocked = crossOriginBlock(request);
  if (blocked) return blocked;
  if (requireJson && mediaType(request) !== "application/json") {
    return NextResponse.json(
      { error: "Content-Type must be application/json." },
      { status: 415 }
    );
  }
  return null;
}
