import Link from "next/link";

const LINKS = [
  { href: "/search", label: "Find vendors" },
  { href: "/for-vendors", label: "For vendors" },
  { href: "/about", label: "About" },
  { href: "/help", label: "Help" },
  { href: "/privacy", label: "Privacy" },
];

export default function Footer() {
  return (
    <footer className="border-t border-line mt-auto">
      <div className="max-w-[1180px] mx-auto px-4 sm:px-7 py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-ink-soft">
        <div>
          <span className="font-display font-semibold text-accent">
            Vel<span className="text-gold">a</span>
          </span>{" "}
          · Weddings &amp; events in Kerala
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex items-center justify-center min-h-10 min-w-10 hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
