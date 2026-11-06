// Profile-strength rule set for the vendor home (PRODUCT_PLAN 7 Vendor/Home,
// P0-12). Pure, no imports, so the API, the page and unit tests share it.
// Documents (P1) join the list once /vendor/documents exists.

export interface StrengthInput {
  checklist: { basics: boolean; logo: boolean; cover: boolean; areas: boolean; languages: boolean };
  /** images: portfolio (gallery) photos only; logo and cover don't count (QA-046). */
  media: { images: number };
  /** pricedUnits: visible offerings with a price; packages and add-ons are counted apart (QA-046). */
  offerings: { pricedUnits: number; packages: number };
}

export interface StrengthItem {
  key: string;
  label: string;
  done: boolean;
  href: string;
}

export const STRENGTH_RULES = {
  photos: 6,
  offerings: 3,
  aboutChars: 150,
} as const;

const soFar = (n: number, min: number) => (n < min ? ` (${n} so far)` : "");

export function profileStrength(s: StrengthInput, about: string): { percent: number; done: number; total: number; items: StrengthItem[] } {
  const items: StrengthItem[] = [
    { key: "basics", label: "Business name, category, district and phone", done: s.checklist.basics, href: "/vendor/profile" },
    { key: "logo", label: "Upload your logo", done: s.checklist.logo, href: "/vendor/media" },
    { key: "cover", label: "Add a cover photo", done: s.checklist.cover, href: "/vendor/media" },
    { key: "photos", label: `Show at least ${STRENGTH_RULES.photos} portfolio photos${soFar(s.media.images, STRENGTH_RULES.photos)}`, done: s.media.images >= STRENGTH_RULES.photos, href: "/vendor/media" },
    { key: "offerings", label: `List ${STRENGTH_RULES.offerings} or more priced offerings, not counting packages${soFar(s.offerings.pricedUnits, STRENGTH_RULES.offerings)}`, done: s.offerings.pricedUnits >= STRENGTH_RULES.offerings, href: "/vendor/offerings" },
    { key: "package", label: "Create a package customers can book in one go", done: s.offerings.packages > 0, href: "/vendor/offerings" },
    { key: "areas", label: "Choose the districts you travel to", done: s.checklist.areas, href: "/vendor/areas" },
    { key: "about", label: `Describe your business (${STRENGTH_RULES.aboutChars}+ characters)`, done: about.trim().length >= STRENGTH_RULES.aboutChars, href: "/vendor/profile#about" },
    { key: "languages", label: "Add the languages you speak", done: s.checklist.languages, href: "/vendor/profile#about" },
  ];
  const done = items.filter((i) => i.done).length;
  return { percent: Math.round((done / items.length) * 100), done, total: items.length, items };
}
