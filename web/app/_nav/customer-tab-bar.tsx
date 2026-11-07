"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCustomerCounts } from "./customer-counts";

// Customer phone tab bar (PRODUCT_PLAN 2.7): Home, Search, Shortlist,
// Enquiries, Account. Below lg only (the header carries these links on wider
// screens). Rendered by the root layout for customer sessions only. Hidden
// on vendor profiles, where the sticky WhatsApp / Get quote bar owns the
// bottom edge, so the two never overlap.

type TabIcon = "home" | "search" | "heart" | "inbox" | "user";

interface Tab {
  href: string;
  label: string;
  icon: TabIcon;
  exact?: boolean;
  also?: string[];
  badge?: "shortlist" | "enquiries";
}

const TABS: Tab[] = [
  { href: "/my", label: "Home", icon: "home", exact: true },
  { href: "/search", label: "Search", icon: "search", also: ["/e", "/c"] },
  { href: "/my/shortlist", label: "Shortlist", icon: "heart", also: ["/my/compare"], badge: "shortlist" },
  { href: "/my/enquiries", label: "Enquiries", icon: "inbox", badge: "enquiries" },
  { href: "/settings", label: "Account", icon: "user", also: ["/my/reviews", "/help"] },
];

const PATHS: Record<TabIcon, React.ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />,
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
};

function active(pathname: string, t: Tab) {
  if (t.exact) return pathname === t.href;
  return [t.href, ...(t.also ?? [])].some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Pages whose own fixed bottom bar takes this space. */
function hasOwnBottomBar(pathname: string) {
  return /^\/vendors\/[^/]+\/?$/.test(pathname);
}

export default function CustomerTabBar() {
  const pathname = usePathname();
  const counts = useCustomerCounts(true);
  if (hasOwnBottomBar(pathname)) return null;

  return (
    <>
      {/* Keeps the footer and page end clear of the fixed bar. */}
      <style>{`@media (max-width: 1023.98px) { body { padding-bottom: calc(57px + env(safe-area-inset-bottom)); } }`}</style>
      <nav
        aria-label="Customer"
        data-testid="customer-tab-bar"
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="flex items-stretch">
          {TABS.map((t) => {
            const on = active(pathname, t);
            const n = t.badge === "shortlist" ? counts.shortlist : t.badge === "enquiries" ? counts.enquiries : 0;
            return (
              <li key={t.href} className="flex flex-1 min-w-0">
                <Link
                  href={t.href}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 min-h-14 min-w-0 px-1 text-[11px] leading-tight transition-colors ${
                    on ? "text-accent font-medium" : "text-ink-soft hover:text-foreground"
                  }`}
                >
                  <span className="relative">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill={t.icon === "heart" && on ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {PATHS[t.icon]}
                    </svg>
                    {n > 0 &&
                      (t.badge === "enquiries" ? (
                        <span className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-accent ring-2 ring-white">
                          <span className="sr-only"> ({n} new)</span>
                        </span>
                      ) : (
                        <span className="absolute -top-1 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-gold-ink text-white text-[10px] font-semibold leading-4 text-center tabular-nums">
                          {n > 99 ? "99+" : n}
                          <span className="sr-only"> saved</span>
                        </span>
                      ))}
                  </span>
                  <span className="truncate max-w-full">{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
