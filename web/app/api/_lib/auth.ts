import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSession, destroySessionCookie, type SessionPayload } from "@/lib/session";
import { findUserById, findVendorByOwner, type UserRecord, type UserRole } from "@/lib/db";
import { homeFor, isNextAllowed, VENDOR_HOME, VENDOR_ONBOARDING } from "@/app/_nav/routes";

// Columns added by migration 004. Optional so this code works before and
// after the migration is applied (SELECT * simply lacks them before).
type LiveUser = UserRecord & { status?: string | null; session_version?: number | null };

export type LiveSessionResult =
  | { state: "ok"; session: SessionPayload; user: LiveUser }
  | { state: "anonymous" }
  | { state: "suspended" };

async function clearCookie() {
  try {
    await destroySessionCookie();
  } catch {
    // Cookies can't be modified while rendering a server component; the
    // cookie is still treated as signed out on every request.
  }
}

/**
 * Reads the cookie and reloads the user from the DB: a deleted user, a
 * suspended or deleted account (users.status) and a cookie issued before
 * the last session_version bump ("force logout") are all signed out.
 */
export async function resolveLiveSession(): Promise<LiveSessionResult> {
  const session = await getSession();
  if (!session) return { state: "anonymous" };
  const user = (await findUserById(session.userId)) as LiveUser | null;
  if (!user) {
    await clearCookie();
    return { state: "anonymous" };
  }
  if (user.status === "suspended" || user.status === "deleted") {
    await clearCookie();
    return { state: user.status === "suspended" ? "suspended" : "anonymous" };
  }
  if (typeof user.session_version === "number" && (session.sessionVersion ?? 0) !== user.session_version) {
    await clearCookie();
    return { state: "anonymous" };
  }
  return {
    state: "ok",
    user,
    session: {
      userId: user.id,
      name: user.name,
      role: user.role,
      sessionVersion: user.session_version ?? undefined,
    },
  };
}

/**
 * Like getSession(), but also checks that the user row still exists and is
 * active, and takes the name and role from the database (so a role change
 * applies at once). A stale cookie is cleared and treated as signed out.
 */
export async function getLiveSession(): Promise<SessionPayload | null> {
  const r = await resolveLiveSession();
  return r.state === "ok" ? r.session : null;
}

/** The session_version to put in a new cookie for this user (0 before migration 004). */
export function sessionVersionOf(user: UserRecord): number {
  const v = (user as LiveUser).session_version;
  return typeof v === "number" ? v : 0;
}

// Guard responses are per-user: never cache them.
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * API guard for /api/vendor/*, /api/my/*, /api/admin/*. Returns the live
 * session, or a response to send back:
 *   signed out -> 401, suspended -> 403, wrong role -> 403.
 * Admin APIs answer 401/403 like the others (owner decision for P1); only
 * the /admin PAGES stay a plain 404 for non-admins (requirePageRole).
 *
 *   const auth = await requireRole("vendor");
 *   if (auth instanceof Response) return auth;
 *   // auth.userId, auth.role ...
 * Ownership checks (vendor touches only its own rows) stay in each handler.
 */
export async function requireRole(
  role: UserRole | UserRole[]
): Promise<SessionPayload | NextResponse> {
  const roles = Array.isArray(role) ? role : [role];
  const r = await resolveLiveSession();
  if (r.state !== "ok") {
    return NextResponse.json(
      { error: r.state === "suspended" ? "This account is suspended." : "Please sign in." },
      { status: r.state === "suspended" ? 403 : 401, headers: NO_STORE }
    );
  }
  if (!roles.includes(r.session.role)) {
    return NextResponse.json({ error: "You don't have access to this." }, { status: 403, headers: NO_STORE });
  }
  return r.session;
}

/**
 * Server-side guard for every /api/admin/* handler (P1-1). Reloads the user
 * from the DB, so a demoted, suspended or force-logged-out admin is refused
 * on the next request: signed out -> 401, signed in but not an active
 * admin (customer, vendor, suspended) -> 403.
 *
 *   const auth = await requireAdmin();
 *   if (auth instanceof Response) return auth;
 *   // auth.userId is the acting admin: pass it to audit() as actorId.
 */
export async function requireAdmin(): Promise<SessionPayload | NextResponse> {
  return requireRole("admin");
}

/** Current path as forwarded by proxy.ts (x-vela-path), for ?next= links. */
async function currentPath(): Promise<string | null> {
  try {
    const h = await headers();
    const p = h.get("x-vela-path");
    return p && p.startsWith("/") && !p.startsWith("//") ? p : null;
  } catch {
    return null;
  }
}

/**
 * Page/layout guard for /vendor, /my and /admin (server components).
 * Signed out -> /login?next=..., suspended -> /login?suspended=1,
 * wrong role -> that role's home. For "admin" every failure is a 404, so
 * the admin area is never revealed.
 */
export async function requirePageRole(
  role: UserRole | UserRole[]
): Promise<{ session: SessionPayload; user: LiveUser }> {
  const roles = Array.isArray(role) ? role : [role];
  const adminOnly = roles.length === 1 && roles[0] === "admin";
  const r = await resolveLiveSession();
  if (r.state === "suspended") {
    if (adminOnly) notFound();
    redirect("/login?suspended=1");
  }
  if (r.state === "anonymous") {
    if (adminOnly) notFound();
    const path = await currentPath();
    redirect(path ? `/login?next=${encodeURIComponent(path)}` : "/login");
  }
  if (!roles.includes(r.session.role)) {
    if (adminOnly) notFound();
    redirect(homeFor(r.session.role));
  }
  return { session: r.session, user: r.user };
}

/** Vendor listing fields the landing logic needs (migration 004 columns optional). */
type LandingVendor = {
  id: number;
  status?: string | null;
  onboarding_step?: number | null;
  onboarding_completed_at?: string | Date | null;
};

/** Onboarding URL for a vendor with no listing or an unfinished one, else null. */
export function onboardingTarget(vendor: LandingVendor | null): string | null {
  if (!vendor) return VENDOR_ONBOARDING;
  // Before migration 004 the column is absent: existing listings count as done.
  if (!("onboarding_completed_at" in vendor)) return null;
  if (vendor.onboarding_completed_at) return null;
  const step = Number(vendor.onboarding_step) || 1;
  return `${VENDOR_ONBOARDING}?step=${Math.min(Math.max(step, 1), 6)}`;
}

/**
 * Where to send a user right after login/signup (2.6). `next` (already
 * checked by safeNext) is honoured only when it belongs to the user's role.
 */
export async function landingFor(
  user: { id: number; role: UserRole },
  next?: string | null
): Promise<string> {
  if (user.role === "vendor") {
    const vendor = (await findVendorByOwner(user.id)) as LandingVendor | null;
    const onboarding = onboardingTarget(vendor);
    if (onboarding) return onboarding;
    return next && isNextAllowed("vendor", next) ? next : VENDOR_HOME;
  }
  if (next && isNextAllowed(user.role, next)) return next;
  return homeFor(user.role);
}
