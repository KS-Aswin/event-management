// Enquiry status machine (PRODUCT_PLAN P2-5) and the message contact mask.
//
// Pure module: no database or Next.js imports, so it can be unit-tested with
// `node --test` and imported from lib/db.ts without an import cycle.
//
// Statuses (quote_requests.status, CHECK in migration 004):
//   pending    new, the vendor hasn't answered yet
//   responded  the vendor replied (message or offer)
//   accepted   the customer accepted an offer
//   booked     confirmed (by the vendor, or by the customer after accepting)
//   declined   the vendor said it isn't a fit
//   withdrawn  the customer withdrew
//   expired    the event date passed while it was still open (system)

export const ENQUIRY_STATUSES = ["pending", "responded", "accepted", "booked", "declined", "withdrawn", "expired"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export type EnquiryActor = "vendor" | "customer" | "system";

export function isEnquiryStatus(v: unknown): v is EnquiryStatus {
  return typeof v === "string" && (ENQUIRY_STATUSES as readonly string[]).includes(v);
}

/**
 * Allowed transitions per actor. Anything not listed is a 409.
 * - vendor: reply (-> responded), send an offer (-> responded), mark booked,
 *   decline ("not a fit"); un-booking or reopening a declined lead is allowed
 *   (the vendor's own record), and responded -> pending only undoes a mis-tap.
 *   Nothing moves a withdrawn enquiry; an expired one can still be recorded
 *   as booked (the event happened through Vela after all).
 * - customer: withdraw while open, accept an offer, mark booked once accepted.
 * - system: open enquiries expire when the event date has passed.
 */
const TRANSITIONS: Record<EnquiryActor, Partial<Record<EnquiryStatus, readonly EnquiryStatus[]>>> = {
  vendor: {
    pending: ["responded", "booked", "declined"],
    responded: ["pending", "booked", "declined"],
    accepted: ["responded", "booked", "declined"],
    booked: ["responded", "declined"],
    declined: ["responded", "booked"],
    expired: ["booked"],
  },
  customer: {
    pending: ["withdrawn", "accepted"],
    responded: ["withdrawn", "accepted"],
    accepted: ["withdrawn", "booked"],
  },
  system: {
    pending: ["expired"],
    responded: ["expired"],
  },
};

export function canTransition(from: string, to: string, actor: EnquiryActor): boolean {
  if (!isEnquiryStatus(from) || !isEnquiryStatus(to) || from === to) return false;
  return (TRANSITIONS[actor][from] ?? []).includes(to);
}

/** The statuses an actor may move an enquiry to from `from` (empty when none). */
export function nextStatuses(from: string, actor: EnquiryActor): EnquiryStatus[] {
  return isEnquiryStatus(from) ? [...(TRANSITIONS[actor][from] ?? [])] : [];
}

/** Thrown inside a transaction for a disallowed change; routes answer 409. */
export class TransitionError extends Error {
  readonly status = 409;
  from: string;
  to: string;
  code: string;
  constructor(from: string, to: string, message?: string, code: string = "INVALID_TRANSITION") {
    super(message ?? transitionMessage(from, to));
    this.name = "TransitionError";
    this.from = from;
    this.to = to;
    this.code = code;
  }
}

export function isTransitionError(err: unknown): err is TransitionError {
  return err instanceof TransitionError || (!!err && typeof err === "object" && (err as Error).name === "TransitionError");
}

const HUMAN: Record<EnquiryStatus, string> = {
  pending: "new",
  responded: "replied",
  accepted: "accepted",
  booked: "booked",
  declined: "declined",
  withdrawn: "withdrawn",
  expired: "expired",
};

export function transitionMessage(from: string, to: string): string {
  const f = isEnquiryStatus(from) ? HUMAN[from] : from;
  const t = isEnquiryStatus(to) ? HUMAN[to] : to;
  if (from === to) return `This enquiry is already ${f}.`;
  if (from === "withdrawn") return "This enquiry was withdrawn, so it can't be changed any more.";
  if (from === "expired") return "This enquiry has expired (the event date has passed).";
  return `An enquiry that is ${f} can't be marked ${t}.`;
}

/** Throws TransitionError unless `actor` may move the enquiry from -> to. */
export function assertTransition(from: string, to: string, actor: EnquiryActor): void {
  if (!canTransition(from, to, actor)) throw new TransitionError(from, to);
}

/** Messages can be posted while the enquiry is still alive (not withdrawn or expired). */
export function canMessage(status: string): boolean {
  return status !== "withdrawn" && status !== "expired";
}

/**
 * Whether the vendor may send a (new version of an) offer: any status the
 * vendor can move to "responded", plus "responded" itself. Not on a booked
 * enquiry (that would un-book it) and never once withdrawn or expired.
 */
export function canSendOffer(status: string): boolean {
  if (status === "responded") return true;
  if (status === "booked") return false;
  return canTransition(status, "responded", "vendor");
}

// ---------------------------------------------------------------------------
// Contact masking in thread messages (while billing is on, PRODUCT_PLAN 9 #17)
// ---------------------------------------------------------------------------

/** BILLING_ENABLED=true turns contact masking on (off by default). */
export function billingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BILLING_ENABLED === "true";
}

// Order matters: WhatsApp links before generic URLs and domains so the whole
// link is masked in one piece. (Same idea as maskContactDetails in
// lib/offering-validation.ts, kept here so this module has no imports.)
const CONTACT_PATTERNS: RegExp[] = [
  // WhatsApp links in any form: wa.me/91..., api.whatsapp.com/send?phone=...
  /\b(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/?\S*/gi,
  // emails
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  // URLs and bare domains
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b[a-z0-9-]+\.(?:com|in|net|org|co|io|me|info|biz|link|app)\b(?:\/\S*)?/gi,
  // phone numbers: 10+ digits with spaces, dashes, dots, brackets or a +country code
  /(?:\+?\d[\s\-().]*){10,}/g,
];

/**
 * Masks phone numbers, emails, WhatsApp links and URLs in a thread message
 * when `enabled` (billing on). With billing off the text is returned as is.
 * The raw message stays in the database; masking happens when it is shown.
 */
export function maskMessageContacts(text: string, enabled: boolean = billingEnabled()): { text: string; masked: boolean } {
  if (!enabled) return { text, masked: false };
  let out = text;
  let masked = false;
  for (const re of CONTACT_PATTERNS) {
    out = out.replace(re, (m) => {
      masked = true;
      // Keep a trailing space the digit pattern may have swallowed.
      return /\s$/.test(m) ? "••• " : "•••";
    });
  }
  return { text: out, masked };
}
