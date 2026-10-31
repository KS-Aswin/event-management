// Returns a same-origin relative path that is safe to redirect to after
// sign-in, or the fallback. Only paths that start with a single "/" are
// accepted: "//host", "/\host" and absolute URLs are rejected so ?next=
// can't be used as an open redirect. "" means "no next": the server then
// picks the role's landing page (see landingFor in app/api/_lib/auth.ts).
export function safeNext(value: unknown, fallback = ""): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Control characters (tabs/newlines) can be stripped by browsers and turn
  // "/\t/evil.com" into "//evil.com".
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  return value;
}

// Appends ?next= to an auth link only when there is one.
export function withNext(path: string, next: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (next) params.set("next", next);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
