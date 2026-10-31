// Role areas, landing pages and redirect rules (PRODUCT_PLAN 2.6).
// Pure functions with no DB or Next imports, so proxy.ts, route handlers,
// server components and client components can all share them.

export type Role = "customer" | "vendor" | "admin";

/**
 * Where a signed-in customer lands. "/" until the customer area (/my, P2-1)
 * ships; change this one constant to "/my" then.
 */
export const CUSTOMER_HOME = "/";
/** Customer quotes and saved vendors live here until /my/* replaces it. */
export const CUSTOMER_DASHBOARD = "/dashboard";
export const VENDOR_HOME = "/vendor";
export const VENDOR_ONBOARDING = "/vendor/onboarding";
export const ADMIN_HOME = "/admin";

export function homeFor(role: Role): string {
  if (role === "vendor") return VENDOR_HOME;
  if (role === "admin") return ADMIN_HOME;
  return CUSTOMER_HOME;
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix + "?");
}

/** Path part of a relative URL, without query or hash. */
export function pathOnly(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}

/**
 * Whether a signed-in user of `role` may be sent to `next` after login.
 * A `next` pointing into another role's area is ignored (P0-2).
 */
export function isNextAllowed(role: Role, next: string): boolean {
  const p = pathOnly(next);
  // Never bounce back to the auth pages themselves.
  if (under(p, "/login") || under(p, "/signup")) return false;
  if (role === "admin") return under(p, "/admin");
  if (under(p, "/admin")) return false;
  if (role === "customer") return !under(p, "/vendor");
  // Vendor: own workspace, public pages, settings. /my is customer-only,
  // except /my/enquiries (enquiries the vendor sent as a customer).
  if (under(p, "/my")) return under(p, "/my/enquiries");
  // /dashboard is retired for vendors; send them to /vendor instead.
  if (under(p, "/dashboard")) return false;
  return true;
}

/**
 * Fixed /dashboard/* -> /vendor/* moves (2.6). Returns null for paths that
 * depend on the role (bare /dashboard) or are not legacy vendor pages.
 */
export function legacyDashboardTarget(path: string): string | null {
  const p = pathOnly(path);
  if (under(p, "/dashboard/create-listing")) return VENDOR_ONBOARDING;
  if (under(p, "/dashboard/edit-listing")) return "/vendor/profile";
  if (under(p, "/dashboard/services")) return "/vendor/offerings";
  if (under(p, "/dashboard/leads")) return "/vendor/leads" + p.slice("/dashboard/leads".length);
  return null;
}

/**
 * Where a signed-in user of `role` is sent when they open `path`, or null
 * when they may stay. Anonymous users are handled by the caller.
 */
export function roleRedirect(role: Role, path: string): string | null {
  const p = pathOnly(path);
  if (under(p, "/admin")) return role === "admin" ? null : "404";
  if (under(p, "/vendor")) {
    if (role === "vendor") return null;
    return role === "admin" ? ADMIN_HOME : CUSTOMER_HOME;
  }
  if (under(p, "/my")) {
    if (role === "admin") return ADMIN_HOME;
    if (role === "vendor") return under(p, "/my/enquiries") ? null : VENDOR_HOME;
    return null;
  }
  if (under(p, "/dashboard")) {
    const legacy = legacyDashboardTarget(p);
    if (legacy) return legacy;
    if (role === "vendor") return VENDOR_HOME;
    if (role === "admin") return ADMIN_HOME;
    // Customers keep the old dashboard until /my ships (CUSTOMER_HOME).
    return CUSTOMER_HOME === "/" ? null : CUSTOMER_HOME;
  }
  return null;
}

/** Vendor listing lifecycle (vendors.status after migration 004). */
export type VendorStatus =
  | "draft"
  | "pending"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "suspended";

export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  draft: "Draft",
  pending: "Under review",
  changes_requested: "Changes requested",
  approved: "Live",
  rejected: "Not approved",
  suspended: "Suspended",
};

export function vendorStatusLabel(status: string | null | undefined): string {
  if (!status) return "No listing yet";
  return VENDOR_STATUS_LABEL[status as VendorStatus] ?? status;
}
