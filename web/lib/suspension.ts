// Message for a suspended account holder (QA-031). No imports on purpose:
// proxy.ts and route handlers both use it.

const SUSPENDED_GENERIC = "This account is suspended. Contact support if you think this is a mistake.";
// Same text as LISTING_SUSPENSION_PREFIX in lib/admin/vendors.ts (kept as a
// literal so this file stays free of admin imports).
const LISTING_PREFIX = "Listing suspended: ";

/**
 * What a suspended user is told (login API and /login?suspended=1, QA-031).
 * Admin suspend dialogs say the reason is shown to the user, so it is, but
 * only to the account holder (after the right password, or from their own
 * signed session cookie). Never put this behind an unauthenticated lookup.
 */
export function suspensionMessage(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  if (!r) return SUSPENDED_GENERIC;
  const listing = r.startsWith(LISTING_PREFIX);
  const text = (listing ? r.slice(LISTING_PREFIX.length) : r).trim().slice(0, 500);
  if (!text) return SUSPENDED_GENERIC;
  return `${listing ? "Your listing and account are suspended" : "This account is suspended"}. Reason: ${text}${/[.!?]$/.test(text) ? "" : "."} Contact support if you think this is a mistake.`;
}
