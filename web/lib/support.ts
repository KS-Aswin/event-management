// The one support contact shown across the app (QA-057): /help,
// /forgot-password, the Settings "Danger zone" and the Terms. Set
// SUPPORT_EMAIL (server) or NEXT_PUBLIC_SUPPORT_EMAIL in the hosting env; the
// placeholder below is only a fallback for local development (".example" can
// never receive mail). Pages that use it are rendered on the server, so the
// value is read at build/render time. See web/README.md.
const FALLBACK = "help@vela.example";

function clean(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s) ? s : null;
}

export const SUPPORT_EMAIL: string =
  clean(process.env.SUPPORT_EMAIL) ?? clean(process.env.NEXT_PUBLIC_SUPPORT_EMAIL) ?? FALLBACK;

/** mailto: link to support, with an optional subject and body. */
export function supportMailto(subject?: string, body?: string): string {
  const q = [
    subject ? `subject=${encodeURIComponent(subject)}` : null,
    body ? `body=${encodeURIComponent(body)}` : null,
  ].filter(Boolean);
  return `mailto:${SUPPORT_EMAIL}${q.length ? `?${q.join("&")}` : ""}`;
}
