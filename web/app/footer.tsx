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
    <footer className="border-t border-line bg-surface-muted mt-auto pb-[env(safe-area-inset-bottom)]">
      <div className="page py-8 sm:py-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 sm:gap-6 text-sm text-ink-soft">
        <div className="flex flex-col gap-1">
          <span>
            <span className="font-display text-lg font-semibold text-accent">
              Vel<span className="text-gold">a</span>
            </span>{" "}
            <span aria-hidden="true">·</span> Weddings &amp; events in Kerala
          </span>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 min-[400px]:grid-cols-3 sm:flex sm:flex-wrap gap-x-4 sm:gap-x-1 -mx-2">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex sm:inline-flex items-center min-h-11 px-2 rounded-md text-[#4d5156] hover:text-accent hover:bg-white transition-colors"
                >
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
