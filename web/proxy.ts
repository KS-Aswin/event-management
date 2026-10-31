import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { pool } from "@/lib/db";
import {
  legacyDashboardTarget,
  roleRedirect,
  type Role,
} from "@/app/_nav/routes";

// Optimistic role routing (PRODUCT_PLAN 2.6). Reads the signed session
// cookie; the only DB read is the /admin page re-check (adminStillLive).
// The real checks (user still exists, status, session_version, role from
// the DB) are the layout guards and requireRole() in each API
// handler; this layer only makes the common redirects fast and keeps the
// admin area a plain 404 for everyone else.

const COOKIE_NAME = "vela_session";

interface CookieSession {
  role: Role;
  userId: number;
  sessionVersion: number;
}

async function cookieSession(request: NextRequest): Promise<CookieSession | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret || secret.length < 32) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const role = payload.role;
    if (role !== "customer" && role !== "vendor" && role !== "admin") return null;
    return {
      role,
      userId: Number(payload.userId),
      sessionVersion: typeof payload.sessionVersion === "number" ? payload.sessionVersion : 0,
    };
  } catch {
    return null;
  }
}

/**
 * /admin pages only: re-check an admin cookie against the DB (role, status,
 * session_version, like resolveLiveSession). The layout guard does the same,
 * but by then the root loading.tsx has already streamed a 200, so a
 * demoted, suspended or force-logged-out admin would get a 200 page with
 * the not-found UI. Doing it here keeps it a real 404. Fails closed.
 */
async function adminStillLive(s: CookieSession): Promise<boolean> {
  if (!Number.isInteger(s.userId)) return false;
  try {
    const { rows } = await pool.query<{ role: string; status: string | null; session_version: number | null }>(
      "SELECT role, status, session_version FROM users WHERE id = $1",
      [s.userId]
    );
    const u = rows[0];
    if (!u || u.role !== "admin") return false;
    if (u.status && u.status !== "active") return false;
    if (typeof u.session_version === "number" && u.session_version !== s.sessionVersion) return false;
    return true;
  } catch {
    return false;
  }
}

function notFoundPage(request: NextRequest) {
  // A path with no route renders app/not-found.tsx with a real 404 status.
  return NextResponse.rewrite(new URL("/_vela/not-found", request.url));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const cookie = await cookieSession(request);
  const role = cookie?.role ?? null;

  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
    // Fast answers by cookie; the handler's requireAdmin() is the real check
    // (it reloads the user, so a stale admin cookie still gets 403 there).
    const noStore = { "Cache-Control": "private, no-store" };
    if (!role) return NextResponse.json({ error: "Please sign in." }, { status: 401, headers: noStore });
    if (role !== "admin") {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403, headers: noStore });
    }
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
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
  if (target === null && role === "admin" && cookie && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    if (!(await adminStillLive(cookie))) return notFoundPage(request);
  }
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
