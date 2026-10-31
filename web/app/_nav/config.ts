// Navigation configs per role (PRODUCT_PLAN 2.7). One header switches
// between these; the vendor workspace shell renders VENDOR_NAV as a sidebar
// on desktop and a bottom tab bar on phones.
import { CUSTOMER_DASHBOARD, VENDOR_HOME, ADMIN_HOME } from "./routes";

export type NavIcon =
  | "home"
  | "leads"
  | "offerings"
  | "media"
  | "profile"
  | "reviews"
  | "settings"
  | "preview"
  | "more"
  | "help"
  | "vendors"
  | "taxonomy"
  | "custom"
  | "users"
  | "enquiries"
  | "audit"
  | "analytics"
  | "external"
  | "logout";

export interface NavItem {
  href: string;
  label: string;
  /** Shorter label for the phone tab bar. */
  short?: string;
  icon: NavIcon;
  /** Shown in the phone bottom bar (others go under "More"). */
  tab?: boolean;
  /** Match only the exact path (for home links). */
  exact?: boolean;
  /** Other path prefixes that highlight this item. */
  also?: string[];
}

export const VENDOR_NAV: NavItem[] = [
  { href: VENDOR_HOME, label: "Home", icon: "home", tab: true, exact: true },
  { href: "/vendor/leads", label: "Leads", icon: "leads", tab: true },
  { href: "/vendor/offerings", label: "Offerings & packages", short: "Offerings", icon: "offerings", tab: true, also: ["/vendor/packages"] },
  { href: "/vendor/media", label: "Media", icon: "media", tab: true },
  { href: "/vendor/profile", label: "Profile & business", short: "Profile", icon: "profile", also: ["/vendor/areas", "/vendor/documents"] },
  { href: "/vendor/reviews", label: "Reviews", icon: "reviews" },
  { href: "/vendor/settings", label: "Settings", icon: "settings" },
];

/** Header links for a vendor browsing public pages (desktop). */
export const VENDOR_HEADER_LINKS = VENDOR_NAV.filter((i) => i.tab || i.icon === "profile");

export interface MenuLink {
  href: string;
  label: string;
}

export const VENDOR_MENU: MenuLink[] = [
  { href: VENDOR_HOME, label: "Workspace home" },
  { href: "/vendor/profile", label: "Business profile" },
  { href: "/vendor/reviews", label: "Reviews" },
  { href: "/vendor/settings", label: "Account settings" },
  { href: "/help", label: "Help" },
];

/** Customer links. /my/* (P2) will replace the old dashboard links. */
export const CUSTOMER_LINKS: MenuLink[] = [
  { href: "/search", label: "Find vendors" },
  { href: CUSTOMER_DASHBOARD, label: "My enquiries" },
];

export const CUSTOMER_MENU: MenuLink[] = [
  { href: CUSTOMER_DASHBOARD, label: "Enquiries & saved vendors" },
  { href: "/settings", label: "Settings" },
  { href: "/help", label: "Help" },
];

/**
 * Admin area navigation (PRODUCT_PLAN 2.5): the admin shell sidebar / phone
 * drawer. The most specific match wins (Custom offerings over Taxonomy).
 */
export const ADMIN_NAV: NavItem[] = [
  { href: ADMIN_HOME, label: "Today", icon: "home", exact: true },
  { href: "/admin/vendors", label: "Vendors", icon: "vendors" },
  { href: "/admin/media", label: "Media", icon: "media" },
  { href: "/admin/reviews", label: "Reviews", icon: "reviews" },
  { href: "/admin/taxonomy", label: "Taxonomy", icon: "taxonomy" },
  { href: "/admin/taxonomy/custom", label: "Custom offerings", icon: "custom" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/enquiries", label: "Enquiries", icon: "enquiries" },
  { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
  { href: "/admin/audit", label: "Audit log", short: "Audit", icon: "audit" },
];

/** Kept for the public header (an admin browsing the public site). */
export const ADMIN_LINKS: MenuLink[] = [{ href: ADMIN_HOME, label: "Admin" }];

export const ADMIN_MENU: MenuLink[] = [
  { href: ADMIN_HOME, label: "Admin home" },
  { href: "/settings", label: "Settings" },
];

export function isActive(
  pathname: string,
  item: { href: string; exact?: boolean; also?: string[] }
): boolean {
  if (item.exact) return pathname === item.href;
  return [item.href, ...(item.also ?? [])].some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}
