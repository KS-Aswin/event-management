// Display helpers for leads (statuses, money, dates, phone links). Shared by
// the vendor leads inbox and the customer dashboard (requests they sent).
import { formatOfferingPrice } from "@/lib/offering-validation";

export type QuoteStatusKey = "pending" | "responded" | "booked" | "declined";

// Vendor-facing labels (the vendor's own leads).
export const LEAD_STATUS_LABEL: Record<QuoteStatusKey, string> = {
  pending: "New",
  responded: "Replied",
  booked: "Booked",
  declined: "Not a fit",
};

// Customer-facing labels (requests the signed-in user sent).
export const CUSTOMER_STATUS_LABEL: Record<QuoteStatusKey, string> = {
  pending: "Waiting for vendor",
  responded: "Vendor replied",
  booked: "Booked",
  declined: "Vendor declined",
};

// Text pill styles: the label carries the meaning, colour only reinforces it.
export const STATUS_PILL_CLASS: Record<QuoteStatusKey, string> = {
  pending: "bg-[#fbf3d9] text-gold-ink border-[#ecd98f]",
  responded: "bg-blue-50 text-blue-800 border-blue-200",
  booked: "bg-accent-tint text-accent-hover border-accent/30",
  declined: "bg-surface-muted text-[#3c4043] border-line-strong",
};

export function asStatus(s: string): QuoteStatusKey {
  return s === "responded" || s === "booked" || s === "declined" ? s : "pending";
}

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const shortFmt = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

/** Parses "YYYY-MM-DD" as a calendar day (noon UTC keeps it on the same IST day). */
function toDate(value: string | Date): Date {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00Z`);
  return new Date(value);
}

export function formatDate(value: string | Date): string {
  const d = toDate(value);
  return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d);
}

/** "Sat, 12 Dec" */
export function formatShortDate(value: string | Date): string {
  const d = toDate(value);
  return Number.isNaN(d.getTime()) ? String(value) : shortFmt.format(d);
}

function dayKey(x: Date): number {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(x).split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

/** Whole calendar days from today (IST) to the date; negative = past. */
export function daysFromToday(value: string | Date): number | null {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((dayKey(d) - dayKey(new Date())) / 86400000);
}

export function relativeDays(diff: number): string {
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

// "12 Dec 2026 (in 43 days)"
export function formatEventDate(value: string | Date): string {
  const diff = daysFromToday(value);
  if (diff === null) return String(value);
  return `${formatDate(value)} (${relativeDays(diff)})`;
}

/** "2 hours ago", "3 days ago", or the date for older items. */
export function formatReceived(value: string | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(d);
}

// Budgets are free text; group plain numbers the Indian way, leave anything else as typed.
export function formatBudget(budget: string): string {
  const trimmed = budget.trim();
  const plain = trimmed.replace(/[₹,\s]/g, "");
  if (/^\d+$/.test(plain)) return `₹${Number(plain).toLocaleString("en-IN")}`;
  return trimmed.startsWith("₹") ? trimmed : `₹${trimmed}`;
}

export function formatBudgetRange(min: number | null, max: number | null, text: string | null): string | null {
  const r = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  if (min && max) return `${r(min)} – ${r(max)}`;
  if (max) return `up to ${r(max)}`;
  if (min) return `from ${r(min)}`;
  return text && text.trim() ? formatBudget(text) : null;
}

export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function telHref(phone: string): string {
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${phoneDigits(phone)}`;
}

// wa.me needs the full international number without "+"; assume India for 10-digit numbers.
export function whatsappUrl(phone: string, text?: string): string | null {
  let digits = phoneDigits(phone);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Prefilled first WhatsApp message to a customer who sent an enquiry. */
export function leadWhatsappText(p: {
  customerName: string;
  vendorName: string;
  eventType?: string | null;
  eventDate?: string | null;
  units?: string[];
}): string {
  const first = p.customerName.trim().split(/\s+/)[0] || "there";
  const what = p.units && p.units.length ? ` for ${p.units.slice(0, 3).join(", ")}` : "";
  const ev = p.eventType ? ` your ${p.eventType.toLowerCase()}` : " your event";
  const when = p.eventDate ? ` on ${formatDate(p.eventDate)}` : "";
  return `Hi ${first}, this is ${p.vendorName} from Vela. Thanks for your enquiry${what} for${ev}${when}. Is now a good time to talk about the details?`;
}

export const SLOT_LABEL: Record<string, string> = {
  morning: "Morning",
  evening: "Evening",
  full: "Full day",
};

export const VENUE_TYPE_LABEL: Record<string, string> = {
  home: "Home",
  hall: "Auditorium / hall",
  outdoor: "Outdoor",
  temple: "Temple",
  church: "Church",
  mosque: "Mosque",
  office: "Office",
  other: "Other",
};

export const FOOD_PREF_LABEL: Record<string, string> = {
  veg: "Vegetarian",
  non_veg: "Non-vegetarian",
  both: "Veg and non-veg",
};

export const CONTACT_PREF_LABEL: Record<string, string> = {
  call: "Phone call",
  whatsapp: "WhatsApp",
  email: "Email",
};

export function formatQty(q: string | number | null): string | null {
  if (q === null || q === undefined || q === "") return null;
  const n = Number(q);
  if (!Number.isFinite(n)) return String(q);
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Price as it was when the customer asked ("₹45,000 per event"), or null. */
export function unitPriceSnapshot(u: {
  price_mode: string | null;
  price_from: number | null;
  price_to: number | null;
  price_unit: string | null;
  unit_label: string | null;
}): string | null {
  if (!u.price_mode) return null;
  if (u.price_mode !== "on_request" && !u.price_from) return null;
  return formatOfferingPrice({
    price_mode: u.price_mode,
    price_from: u.price_from ?? 0,
    price_to: u.price_to,
    price_unit: u.price_unit ?? "event",
    unit_label: u.unit_label,
  });
}
