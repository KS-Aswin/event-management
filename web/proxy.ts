import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import {
  legacyDashboardTarget,
  roleRedirect,
  type Role,
} from "@/app/_nav/routes";

// Optimistic role routing (PRODUCT_PLAN 2.6). Reads only the signed session
// cookie: no DB. The real checks (user still exists, status, session_version,
// role from the DB) are the layout guards and requireRole() in each API
// handler; this layer only makes the common redirects fast and keeps the
// admin area a plain 404 for everyone else.

const COOKIE_NAME = "vela_session";

async function cookieRole(request: NextRequest): Promise<Role | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret || secret.length < 32) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const role = payload.role;
    return role === "customer" || role === "vendor" || role === "admin" ? role : null;
  } catch {
    return null;
  }
}

function notFoundPage(request: NextRequest) {
  // A path with no route renders app/not-found.tsx with a real 404 status.
  return NextResponse.rewrite(new URL("/_vela/not-found", request.url));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const role = await cookieRole(request);

  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
    if (role !== "admin") return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.next();
  }

  // Old vendor pages moved for good; bookmarks and e-mails keep working.
  const legacy = legacyDashboardTarget(pathname);
  if (legacy) return NextResponse.redirect(new URL(legacy, request.url), 308);

  if (!role) {
    if (pathname === "/admin" || pathname.startsWith("/admin/")) return notFoundPage(request);
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  const target = roleRedirect(role, pathname);
  if (target === "404") return notFoundPage(request);
  if (target) return NextResponse.redirect(new URL(target, request.url));

  // Lets server guards build ?next= links (layouts don't get the pathname).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-vela-path", pathname + search);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // Signed-in areas are per-user: never cache them in shared caches.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/vendor/:path*",
    "/my/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
    "/api/admin/:path*",
  ],
};
