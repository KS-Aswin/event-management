// Small display helpers shared by every vendor surface (search cards, /e and
// /my mini cards, the profile), so wording and prices agree everywhere.
// Pure: safe in server and client components.

/** "1 review", "12 reviews" (QA-024). */
export function reviewCountLabel(n: number): string {
  return `${n} ${n === 1 ? "review" : "reviews"}`;
}

/**
 * The vendor's single "from" price (QA-023): the vendors.price_label cache
 * kept by recomputeVendorPrice, or null when the vendor has no priced offering.
 */
export function vendorFromPrice(v: { price?: number | string | null; price_label?: string | null }): string | null {
  return Number(v.price) > 0 && v.price_label ? v.price_label : null;
}
