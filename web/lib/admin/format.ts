// Small text helpers for admin pages.

const nf = new Intl.NumberFormat("en-IN");

/**
 * "1 vendor", "2 vendors", "1 entry", "647 entries". English plurals are not
 * always noun + "s", so irregular ones pass their plural form explicitly.
 */
export function plural(n: number, one: string, many?: string): string {
  const word = n === 1 ? one : many ?? defaultPlural(one);
  return `${nf.format(n)} ${word}`;
}

function defaultPlural(word: string): string {
  // consonant + y -> ies (entry, enquiry, category); vowel + y keeps the y (day, key)
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** Admin-hidden media carry status_reason "admin:<reason>" so the vendor cannot unhide them. */
export const ADMIN_HIDE_PREFIX = "admin:";

/** A media status reason without the internal "admin:" marker (QA-073). */
export function displayStatusReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const s = reason.startsWith(ADMIN_HIDE_PREFIX) ? reason.slice(ADMIN_HIDE_PREFIX.length).trim() : reason.trim();
  return s || null;
}

/** True when an admin hid the item (only an admin can show it again). */
export function isAdminHidden(status: string, reason: string | null | undefined): boolean {
  return status === "hidden" && (reason ?? "").startsWith(ADMIN_HIDE_PREFIX);
}

/** Cuts text at a word boundary and adds an ellipsis when it is longer than max (QA-079). */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
