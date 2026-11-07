// Phone numbers in E.164 (P2-2): Indian numbers typed the local way and any
// international number written with "+" or "00" (UAE +971, Gulf, UK, US...).
// Shared by the enquiry API, the quote dialog and the profile contact links.

/**
 * Normalises a phone number to E.164 ("+919847012345", "+971501234567"), or
 * returns null when it isn't a plausible number.
 *  - spaces, dashes, dots and brackets are ignored;
 *  - "00" is read as "+";
 *  - without a country code it must be an Indian mobile (10 digits starting
 *    6-9, optionally written 0XXXXXXXXXX or 91XXXXXXXXXX);
 *  - +91 must also be an Indian mobile;
 *  - +971 must be a UAE number (8-9 digits; mobiles start with 5);
 *  - any other "+" number: country code 1-9 then 8-15 digits in all (E.164).
 */
export function toE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (!s || s.length > 20) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
    if (digits.startsWith("91")) {
      return /^91[6-9]\d{9}$/.test(digits) ? `+${digits}` : null;
    }
    if (digits.startsWith("971")) {
      return /^971\d{8,9}$/.test(digits) ? `+${digits}` : null;
    }
    return `+${digits}`;
  }
  if (!/^\d+$/.test(s)) return null;
  if (s.length === 12 && s.startsWith("91")) s = s.slice(2);
  else if (s.length === 11 && s.startsWith("0")) s = s.slice(1);
  return /^[6-9]\d{9}$/.test(s) ? `+91${s}` : null;
}

/** Digits only, as wa.me wants them ("919847012345"), or null. */
export function waDigits(raw: unknown): string | null {
  const e = toE164(raw);
  return e ? e.slice(1) : null;
}

/** wa.me click-to-chat link with a URL-encoded prefilled message, or null. */
export function whatsappLink(raw: unknown, text?: string): string | null {
  const d = waDigits(raw);
  if (!d) return null;
  return text ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : `https://wa.me/${d}`;
}

/** Readable form: "+91 98470 12345" for India, "+971 50 123 4567"-ish otherwise. */
export function formatE164(e164: string): string {
  if (/^\+91\d{10}$/.test(e164)) return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
  if (/^\+971\d{8,9}$/.test(e164)) {
    const rest = e164.slice(4);
    return `+971 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
  }
  return e164;
}
