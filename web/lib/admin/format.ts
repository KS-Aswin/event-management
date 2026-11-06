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
