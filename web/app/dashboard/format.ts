// Shared display helpers for the dashboard (statuses, money, dates, phone links).

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
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  responded: "bg-blue-50 text-blue-800 border-blue-200",
  booked: "bg-accent-tint text-accent border-accent/30",
  declined: "bg-gray-100 text-gray-700 border-gray-300",
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

export function formatDate(value: string | Date): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d);
}

// "12 Dec 2026 (in 43 days)" — relative part counted in whole calendar days (IST).
export function formatEventDate(value: string | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const dayKey = (x: Date) => {
    const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })
      .format(x)
      .split("-")
      .map(Number);
    return Date.UTC(y, m - 1, day);
  };
  const diff = Math.round((dayKey(d) - dayKey(new Date())) / 86400000);
  const rel =
    diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff === -1 ? "yesterday" : diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
  return `${dateFmt.format(d)} (${rel})`;
}

// Budgets are free text; group plain numbers the Indian way, leave anything else as typed.
export function formatBudget(budget: string): string {
  const trimmed = budget.trim();
  const plain = trimmed.replace(/[₹,\s]/g, "");
  if (/^\d+$/.test(plain)) return `₹${Number(plain).toLocaleString("en-IN")}`;
  return trimmed.startsWith("₹") ? trimmed : `₹${trimmed}`;
}

export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

// wa.me needs the full international number without "+"; assume India for 10-digit numbers.
export function whatsappUrl(phone: string): string | null {
  let digits = phoneDigits(phone);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 ? `https://wa.me/${digits}` : null;
}
