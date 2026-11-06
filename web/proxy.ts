import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import { pool } from "@/lib/db";
import { suspensionMessage } from "@/lib/suspension";
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
/** Request header proxy.ts sets for /login when the cookie user is suspended. */
const SUSPENSION_HEADER = "x-vela-suspension";
/**
 * QA-056: short-lived signed note "user N was signed out here because they
 * are suspended", set when proxy.ts clears a suspended user's session on
 * /login. The session cookie is gone after the first /login request, but the
 * browser often asks for /login?suspended=1 more than once (prefetch, the
 * streamed redirect's meta refresh, a reload); this lets each of those still
 * look the reason up live from the DB. HttpOnly and signed, so it can't be
 * forged or read by scripts; it holds only the user id, never the reason.
 */
const NOTICE_COOKIE = "vela_suspended";
const NOTICE_AUDIENCE = "vela-suspension-notice";
const NOTICE_TTL_S = 10 * 60;

function sessionKey(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? new TextEncoder().encode(secret) : null;
}

async function signNotice(userId: number): Promise<string | null> {
  const key = sessionKey();
  if (!key) return null;
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(NOTICE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${NOTICE_TTL_S}s`)
    .sign(key);
}

async function noticeUserId(request: NextRequest): Promise<number | null> {
  const token = request.cookies.get(NOTICE_COOKIE)?.value;
  const key = sessionKey();
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { audience: NOTICE_AUDIENCE });
    return Number.isInteger(payload.uid) ? (payload.uid as number) : null;
  } catch {
    return null;
  }
}

/** Live reason for a suspended user, or null if they aren't suspended (any more). */
async function liveSuspension(userId: number): Promise<string | null> {
  const { rows } = await pool.query<{ status: string | null; suspended_reason: string | null }>(
    "SELECT status, suspended_reason FROM users WHERE id = $1",
    [userId]
  );
  return rows[0]?.status === "suspended" ? suspensionMessage(rows[0].suspended_reason) : null;
}

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

// Vendor detail pages that show one record: /vendor/leads/<id>,
// /vendor/offerings/<id> and /vendor/offerings/packages/<id>.
const VENDOR_RECORD_PAGES: { re: RegExp; sql: string }[] = [
  {
    re: /^\/vendor\/leads\/([^/]+)\/?$/,
    sql: `SELECT 1 FROM quote_requests q JOIN vendors v ON v.id = q.vendor_id WHERE q.id = $1 AND v.owner_id = $2`,
  },
  {
    re: /^\/vendor\/offerings\/packages\/(?!new\/?$)([^/]+)\/?$/,
    sql: `SELECT 1 FROM services s JOIN vendors v ON v.id = s.vendor_id WHERE s.id = $1 AND s.kind = 'package' AND v.owner_id = $2`,
  },
  {
    re: /^\/vendor\/offerings\/(?!new\/?$|packages(?:\/|$))([^/]+)\/?$/,
    sql: `SELECT 1 FROM services s JOIN vendors v ON v.id = s.vendor_id WHERE s.id = $1 AND v.owner_id = $2`,
  },
];

/**
 * Another vendor's lead/offering/package (or a missing or malformed id) must
 * be a real 404. The page also calls notFound(), but by then the root
 * loading.tsx has streamed a 200 (same reason as adminStillLive). Returns
 * false only when the record is definitely not this vendor's; a DB error
 * falls through to the page, whose own ownership check still hides the data.
 */
async function vendorOwnsRecord(pathname: string, userId: number): Promise<boolean> {
  for (const { re, sql } of VENDOR_RECORD_PAGES) {
    const m = re.exec(pathname);
    if (!m) continue;
    if (!/^[1-9]\d{0,9}$/.test(m[1]) || Number(m[1]) > 2147483647 || !Number.isInteger(userId)) return false;
    try {
      const { rowCount } = await pool.query(sql, [Number(m[1]), userId]);
      return (rowCount ?? 0) > 0;
    } catch {
      return true;
    }
  }
  return true;
}

/**
 * /my/enquiries/<id> (customer thread, P2-5): the signed-in user's own
 * enquiry only, as a real 404 otherwise (same streaming reason as above).
 * A DB error falls through to the page, which checks again.
 */
async function ownsEnquiry(pathname: string, userId: number): Promise<boolean> {
  const m = /^\/my\/enquiries\/([^/]+)\/?$/.exec(pathname);
  if (!m) return true;
  if (!/^[1-9]\d{0,9}$/.test(m[1]) || Number(m[1]) > 2147483647 || !Number.isInteger(userId)) return false;
  try {
    const { rowCount } = await pool.query("SELECT 1 FROM quote_requests WHERE id = $1 AND customer_id = $2", [Number(m[1]), userId]);
    return (rowCount ?? 0) > 0;
  } catch {
    return true;
  }
}

/**
 * Public browse/tracking pages (P2-3, P2-8): an unknown slug or token is a
 * real 404. The root loading.tsx starts streaming before the page's
 * notFound() runs, so the status would otherwise be 200. Returns true when
 * the record exists (or the path isn't one of these, or the DB failed: the
 * page then checks again and still shows the not-found screen).
 */
async function publicRecordExists(pathname: string): Promise<boolean> {
  const m = /^\/(e|c|enquiry)\/([^/]+)\/?$/.exec(pathname);
  if (!m) return true;
  const [, kind, key] = m;
  if (kind === "enquiry") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return false;
  } else if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(key)) {
    return false;
  }
  const sql =
    kind === "e"
      ? "SELECT 1 FROM event_types WHERE slug = $1 AND active"
      : kind === "c"
        ? "SELECT 1 FROM categories WHERE slug = $1 AND active"
        : "SELECT 1 FROM quote_requests WHERE guest_token = $1::uuid";
  try {
    const { rowCount } = await pool.query(sql, [kind === "enquiry" ? key.toLowerCase() : key]);
    return (rowCount ?? 0) > 0;
  } catch {
    return true;
  }
}

/**
 * /vendors/<id> (QA-001): unknown, malformed and non-public (draft, pending,
 * suspended, unpublished) listings are a real 404 instead of a 200 with the
 * not-found UI. The owner and a live admin still get the preview (the page
 * checks again). A DB error falls through to the page.
 */
async function vendorPageVisible(pathname: string, cookie: CookieSession | null): Promise<boolean> {
  const m = /^\/vendors\/([^/]+)\/?$/.exec(pathname);
  if (!m) return true;
  if (!/^[1-9]\d{0,9}$/.test(m[1]) || Number(m[1]) > 2147483647) return false;
  try {
    const { rows } = await pool.query<{ status: string; published: boolean | null; owner_id: number | null }>(
      "SELECT status, published, owner_id FROM vendors WHERE id = $1",
      [Number(m[1])]
    );
    const v = rows[0];
    if (!v) return false;
    if (v.status === "approved" && v.published !== false) return true;
    if (!cookie) return false;
    if (v.owner_id !== null && v.owner_id === cookie.userId) return true;
    return cookie.role === "admin" && (await adminStillLive(cookie));
  } catch {
    return true;
  }
}

/**
 * /login and /signup (QA-018, QA-031): a cookie whose user is suspended,
 * deleted, gone or force-logged-out is removed here, both from the browser
 * and from this request, so the root layout's header doesn't show a
 * signed-in user next to "This account is suspended". (Server components
 * can't delete cookies, so the guards that redirect here can't.) For a
 * suspended user the reason travels to the page in x-vela-suspension; the
 * cookie's signature proves it is the account holder.
 */
async function authPageResponse(request: NextRequest, cookie: CookieSession | null): Promise<NextResponse> {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(SUSPENSION_HEADER); // never trust a client-sent copy
  let clear = false;
  let noticeFor: number | null = null; // set the QA-056 note for this user
  let dropNotice = false;
  if (cookie) {
    try {
      const { rows } = await pool.query<{ status: string | null; session_version: number | null; suspended_reason: string | null }>(
        "SELECT status, session_version, suspended_reason FROM users WHERE id = $1",
        [cookie.userId]
      );
      const u = rows[0];
      if (!u || (u.status && u.status !== "active")) {
        clear = true;
        if (u?.status === "suspended") {
          requestHeaders.set(SUSPENSION_HEADER, encodeURIComponent(suspensionMessage(u.suspended_reason)));
          noticeFor = cookie.userId;
        }
      } else if (typeof u.session_version === "number" && u.session_version !== cookie.sessionVersion) {
        clear = true;
      } else {
        dropNotice = request.cookies.has(NOTICE_COOKIE); // signed in and active again
      }
    } catch {
      // DB down: leave the cookie; the page's live check still shows the form.
    }
  } else if (request.cookies.has(COOKIE_NAME)) {
    clear = true; // expired or tampered token
  }
  // Session already cleared by an earlier /login request (QA-056): the note
  // says whose it was; show their live reason on /login?suspended=1 only.
  if (!noticeFor && !requestHeaders.has(SUSPENSION_HEADER) && request.cookies.has(NOTICE_COOKIE)) {
    const uid = await noticeUserId(request);
    if (uid === null) {
      dropNotice = true;
    } else if (request.nextUrl.pathname === "/login" && request.nextUrl.searchParams.get("suspended") === "1") {
      try {
        const message = await liveSuspension(uid);
        if (message) requestHeaders.set(SUSPENSION_HEADER, encodeURIComponent(message));
        else dropNotice = true; // reinstated meanwhile
      } catch {
        // DB down: the page shows the generic notice.
      }
    }
  }
  if (clear) {
    const rest = request.cookies
      .getAll()
      .filter((c) => c.name !== COOKIE_NAME)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    if (rest) requestHeaders.set("cookie", rest);
    else requestHeaders.delete("cookie");
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (clear) response.cookies.delete(COOKIE_NAME);
  const notice = noticeFor !== null ? await signNotice(noticeFor) : null;
  if (notice) {
    response.cookies.set(NOTICE_COOKIE, notice, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/login",
      maxAge: NOTICE_TTL_S,
    });
  } else if (dropNotice) {
    response.cookies.set(NOTICE_COOKIE, "", { path: "/login", maxAge: 0 });
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * /admin/vendors/<id> and /admin/users/<id> (QA-052): a missing or malformed
 * id is a real 404 (the page's notFound() runs after the root loading.tsx
 * has streamed a 200). A DB error falls through to the page.
 */
async function adminRecordExists(pathname: string): Promise<boolean> {
  const m = /^\/admin\/(vendors|users)\/([^/]+)\/?$/.exec(pathname);
  if (!m) return true;
  if (!/^[1-9]\d{0,9}$/.test(m[2]) || Number(m[2]) > 2147483647) return false;
  try {
    const sql = m[1] === "vendors" ? "SELECT 1 FROM vendors WHERE id = $1" : "SELECT 1 FROM users WHERE id = $1";
    const { rowCount } = await pool.query(sql, [Number(m[2])]);
    return (rowCount ?? 0) > 0;
  } catch {
    return true;
  }
}

/** The same admin URL with a 404 status: the page's notFound() renders app/admin/not-found.tsx inside the admin shell. */
function adminNotFoundPage(request: NextRequest) {
  const response = NextResponse.rewrite(request.nextUrl, { status: 404 });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function notFoundPage(request: NextRequest) {
  // A path with no route renders app/not-found.tsx with a real 404 status.
  return NextResponse.rewrite(new URL("/_vela/not-found", request.url));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (/^\/(e|c|enquiry)\//.test(pathname)) {
    if (!(await publicRecordExists(pathname))) return notFoundPage(request);
    const response = NextResponse.next();
    // Tracking links carry a secret token: keep them out of shared caches.
    if (pathname.startsWith("/enquiry/")) response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  // One-time password reset links carry a secret: never cached, never sent
  // on as a Referer.
  if (pathname === "/reset-password" || pathname.startsWith("/reset-password/")) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex");
    return response;
  }

  const cookie = await cookieSession(request);
  const role = cookie?.role ?? null;

  if (pathname === "/login" || pathname === "/signup") return authPageResponse(request, cookie);

  if (pathname.startsWith("/vendors/")) {
    if (!(await vendorPageVisible(pathname, cookie))) return notFoundPage(request);
    return NextResponse.next();
  }

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
    if (!(await adminRecordExists(pathname))) return adminNotFoundPage(request);
  }
  if (target === "404") return notFoundPage(request);
  if (target === null && role === "vendor" && cookie && !(await vendorOwnsRecord(pathname, cookie.userId))) {
    return notFoundPage(request);
  }
  if (target === null && (role === "customer" || role === "vendor") && cookie && !(await ownsEnquiry(pathname, cookie.userId))) {
    return notFoundPage(request);
  }
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
    "/e/:path*",
    "/c/:path*",
    "/enquiry/:path*",
    "/vendors/:path*",
    "/login",
    "/signup",
    "/reset-password",
  ],
};
