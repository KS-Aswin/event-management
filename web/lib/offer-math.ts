// Itemised quote offers (PRODUCT_PLAN P2-4): request parsing and totals.
//
// Pure module (no database), unit-tested in tests/customer-thread.test.mjs.
// The vendor types rupees; everything is stored in paise (BIGINT). The server
// recomputes every line amount and the total; the subtotal the client sends
// must equal the sum of the lines (400 otherwise) and a total, when sent,
// must equal subtotal + travel + GST - discount.

export const OFFER_LIMITS = {
  lines: 40,
  label: 120,
  unit: 30,
  terms: 2000,
  maxQty: 100_000,
  /** ₹10 crore per amount. */
  maxRupees: 100_000_000,
  validDays: 365,
} as const;

export interface OfferLineInput {
  serviceId: number | null;
  label: string;
  /** Quantity as typed (up to 2 decimals). */
  qty: number;
  unit: string;
  unitPricePaise: number;
  amountPaise: number;
}

export interface OfferInput {
  lines: OfferLineInput[];
  subtotalPaise: number;
  travelPaise: number;
  discountPaise: number;
  gstPaise: number;
  totalPaise: number;
  validUntil: string | null;
  advancePct: number | null;
  terms: string;
}

export type OfferParseResult = { ok: true; offer: OfferInput } | { ok: false; field: string; error: string };

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(field: string, error: string): OfferParseResult {
  return { ok: false, field, error };
}

/**
 * Rupees (number or numeric string, at most 2 decimals, 0..maxRupees) to
 * integer paise, or null when invalid.
 */
export function rupeesToPaise(v: unknown): number | null {
  let s: string;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    s = String(v);
  } else if (typeof v === "string") {
    s = v.trim().replace(/,/g, "");
  } else return null;
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise > OFFER_LIMITS.maxRupees * 100) return null;
  return paise;
}

/** Quantity (> 0, at most 2 decimals) in hundredths, or null. */
function qtyHundredths(v: unknown): number | null {
  let s: string;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    s = String(v);
  } else if (typeof v === "string") s = v.trim();
  else return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const h = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return h > 0 && h <= OFFER_LIMITS.maxQty * 100 ? h : null;
}

/** qty x unit price, rounded to the nearest paisa. */
export function lineAmountPaise(qtyH: number, unitPricePaise: number): number {
  return Math.round((qtyH * unitPricePaise) / 100);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today's calendar date in India (offers and event dates are IST days). */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : null;
}

/**
 * Validates an offer body:
 *   { lines: [{ serviceId?, label, qty, unit, unitPrice }], subtotal,
 *     travel?, discount?, gst?, total?, validUntil?, advancePct?, terms? }
 * Money is in rupees. `today` is YYYY-MM-DD (IST).
 */
export function parseOfferBody(raw: unknown, today: string = todayIST()): OfferParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("body", "Invalid request body.");
  const b = raw as Record<string, unknown>;

  if (!Array.isArray(b.lines) || b.lines.length === 0) return fail("lines", "Add at least one line to the offer.");
  if (b.lines.length > OFFER_LIMITS.lines) return fail("lines", `An offer can have at most ${OFFER_LIMITS.lines} lines.`);

  const lines: OfferLineInput[] = [];
  for (let i = 0; i < b.lines.length; i++) {
    const l = b.lines[i] as Record<string, unknown> | null;
    const at = `lines[${i}]`;
    if (!l || typeof l !== "object" || Array.isArray(l)) return fail(at, `Line ${i + 1} is not valid.`);
    let serviceId: number | null = null;
    if (l.serviceId !== undefined && l.serviceId !== null) {
      if (!Number.isSafeInteger(l.serviceId) || (l.serviceId as number) < 1 || (l.serviceId as number) > 2147483647) {
        return fail(`${at}.serviceId`, `Line ${i + 1}: unknown offering.`);
      }
      serviceId = l.serviceId as number;
    }
    const label = text(l.label, OFFER_LIMITS.label);
    if (!label || label.length < 2) return fail(`${at}.label`, `Line ${i + 1}: describe the item (2 to ${OFFER_LIMITS.label} characters).`);
    const unit = text(l.unit, OFFER_LIMITS.unit);
    if (!unit) return fail(`${at}.unit`, `Line ${i + 1}: give a unit (for example plate, event or hour).`);
    const q = qtyHundredths(l.qty);
    if (q === null) return fail(`${at}.qty`, `Line ${i + 1}: quantity must be more than 0 (up to 2 decimals).`);
    const unitPricePaise = rupeesToPaise(l.unitPrice);
    if (unitPricePaise === null) return fail(`${at}.unitPrice`, `Line ${i + 1}: enter a price in rupees (up to 2 decimals).`);
    const amountPaise = lineAmountPaise(q, unitPricePaise);
    if (l.amount !== undefined && l.amount !== null) {
      const sent = rupeesToPaise(l.amount);
      if (sent === null || sent !== amountPaise) {
        return fail(`${at}.amount`, `Line ${i + 1}: the amount doesn't match quantity × price.`);
      }
    }
    lines.push({ serviceId, label, qty: q / 100, unit, unitPricePaise, amountPaise });
  }

  const sum = lines.reduce((s, l) => s + l.amountPaise, 0);
  const subtotalPaise = rupeesToPaise(b.subtotal);
  if (subtotalPaise === null) return fail("subtotal", "Enter the subtotal in rupees.");
  if (subtotalPaise !== sum) return fail("subtotal", "The line amounts don't add up to the subtotal.");

  const money = (key: string, label: string): number | OfferParseResult => {
    const v = b[key];
    if (v === undefined || v === null || v === "") return 0;
    const p = rupeesToPaise(v);
    return p === null ? fail(key, `${label} must be an amount in rupees (up to 2 decimals).`) : p;
  };
  const travel = money("travel", "Travel");
  if (typeof travel !== "number") return travel;
  const discount = money("discount", "Discount");
  if (typeof discount !== "number") return discount;
  const gst = money("gst", "GST");
  if (typeof gst !== "number") return gst;

  const gross = subtotalPaise + travel + gst;
  if (discount > gross) return fail("discount", "The discount can't be more than the offer total.");
  const totalPaise = gross - discount;
  if (totalPaise <= 0) return fail("total", "The offer total must be more than ₹0.");
  if (b.total !== undefined && b.total !== null && b.total !== "") {
    const t = rupeesToPaise(b.total);
    if (t === null || t !== totalPaise) return fail("total", "The total doesn't match subtotal + travel + GST − discount.");
  }

  let validUntil: string | null = null;
  if (b.validUntil !== undefined && b.validUntil !== null && b.validUntil !== "") {
    if (typeof b.validUntil !== "string" || !isRealDate(b.validUntil)) return fail("validUntil", "Pick a valid date.");
    if (b.validUntil < today) return fail("validUntil", "The offer can't be valid until a date in the past.");
    if (b.validUntil > addDays(today, OFFER_LIMITS.validDays)) return fail("validUntil", "Pick a date within a year.");
    validUntil = b.validUntil;
  }

  let advancePct: number | null = null;
  if (b.advancePct !== undefined && b.advancePct !== null && b.advancePct !== "") {
    const n = typeof b.advancePct === "string" && /^\d{1,3}$/.test(b.advancePct.trim()) ? Number(b.advancePct) : b.advancePct;
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > 100) return fail("advancePct", "Advance must be 0 to 100 %.");
    advancePct = n as number;
  }

  let terms = "";
  if (b.terms !== undefined && b.terms !== null) {
    if (typeof b.terms !== "string") return fail("terms", "Terms must be text.");
    terms = b.terms.replace(CONTROL, "").trim();
    if (terms.length > OFFER_LIMITS.terms) return fail("terms", `Terms can be at most ${OFFER_LIMITS.terms} characters.`);
  }

  return {
    ok: true,
    offer: { lines, subtotalPaise, travelPaise: travel, discountPaise: discount, gstPaise: gst, totalPaise, validUntil, advancePct, terms },
  };
}

/** "₹1,23,456" or "₹1,234.50" from paise. */
export function formatPaise(paise: number | string): string {
  const p = Number(paise);
  if (!Number.isFinite(p)) return "₹0";
  const rupees = p / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: p % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const OFFER_DATE_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A calendar day for notification copy: "2026-11-20" -> "20 Nov 2026" (the
 * app's friendly Indian format; QA-030). Anything unparseable is returned as is.
 */
export function formatOfferDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : OFFER_DATE_FMT.format(d);
}
