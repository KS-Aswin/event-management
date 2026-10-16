// Small, dependency-free input validators shared by API routes.

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Accepts only real calendar dates written as YYYY-MM-DD (rejects "2027-02-31").
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// Trimmed string, or "" when the value isn't a string.
export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Parses a positive whole number from a number or numeric string, else null.
export function positiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isInteger(n) && n > 0 && n < 2_000_000_000 ? n : null;
}
