// Quantity text for an offer line (QA-104): "2 events", "1 plate", or just
// "2" when the vendor left the unit empty. Shared by every page that shows an
// offer's lines, so the vendor and the customer read the same thing.
// No imports, so tests/qa5-vendor.test.mjs can load it directly.

/** Same output as formatQty in app/vendor/leads/format.ts. */
function formatQty(q: string | number | null): string | null {
  if (q === null || q === undefined || q === "") return null;
  const n = Number(q);
  if (!Number.isFinite(n)) return String(q);
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

const IRREGULAR: Record<string, string> = { person: "people", child: "children", piece: "pieces", sqft: "sqft" };

/** English plural of the last word of a unit ("day" -> "days", "hour" -> "hours"). */
export function pluralUnit(unit: string): string {
  const m = /^(.*?)([A-Za-z]+)$/.exec(unit);
  if (!m) return unit;
  const [, head, word] = m;
  const lower = word.toLowerCase();
  // Abbreviations (kg, sq ft, PAX) and words that already read as plural stay.
  if (word.length <= 2 || word === word.toUpperCase() || /(s|ss)$/.test(lower)) return unit;
  if (IRREGULAR[lower]) return head + IRREGULAR[lower];
  if (/(x|z|ch|sh)$/.test(lower)) return `${head}${word}es`;
  if (/[^aeiou]y$/.test(lower)) return `${head}${word.slice(0, -1)}ies`;
  return `${head}${word}s`;
}

export function offerLineQty(qty: string | number | null, unit: string | null | undefined): string {
  const q = formatQty(qty) ?? "";
  const u = (unit ?? "").trim();
  if (!u) return q;
  return `${q} ${Number(qty) === 1 ? u : pluralUnit(u)}`.trim();
}
