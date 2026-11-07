"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { UserRole } from "@/lib/db";
import {
  ADMIN_LINKS,
  ADMIN_MENU,
  ADMIN_NAV,
  CUSTOMER_LINKS,
  CUSTOMER_MENU,
  VENDOR_HEADER_LINKS,
  VENDOR_MENU,
  VENDOR_NAV,
  isActive,
  type MenuLink,
} from "./_nav/config";
import { ADMIN_HOME, VENDOR_HOME, VENDOR_ONBOARDING } from "./_nav/routes";
import NotificationBell from "./_nav/notification-bell";
import ShortlistMerge from "./_nav/shortlist-merge";
import { useCustomerCounts } from "./_nav/customer-counts";

// Where the Back button goes when there is no in-app history to return to
// (page opened from a shared link, bookmark or new tab).
let navigatedInApp = false;

function parentRoute(pathname: string): string {
  if (pathname.startsWith("/vendors/")) return "/search";
  if (pathname.startsWith("/vendor/")) return VENDOR_HOME;
  if (pathname.startsWith("/admin/")) return ADMIN_HOME;
  if (pathname.startsWith("/my/")) return "/my";
  return "/";
}

function under(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Sections linked from the header on an unknown /admin/* page (QA-087). */
const ADMIN_404_LINKS = [ADMIN_HOME, "/admin/vendors", "/admin/users", "/admin/enquiries"];

const noopSubscribe = () => () => {};

function subscribeToBody(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * True in the admin area when the page is the root 404 and the admin shell
 * (app/_nav/admin-shell.tsx, marked data-admin-shell) is not on it: an
 * unknown /admin/* URL renders the root not-found outside the admin layout. False on the server
 * and outside the admin area, so normal admin pages never flash this header.
 */
function useAdminShellMissing(adminArea: boolean): boolean {
  return useSyncExternalStore(
    adminArea ? subscribeToBody : noopSubscribe,
    // The root not-found's <main> sits right in #content; the loading
    // fallback (a div) doesn't count, so a normal admin page that is still
    // streaming in doesn't flash this header.
    () => adminArea && !document.querySelector("[data-admin-shell]") && !!document.querySelector("#content > main"),
    () => false
  );
}

// One header, four nav configs (PRODUCT_PLAN 2.7). The role comes from the
// server session passed in by the root layout, never from a client-only check.
export default function Header({
  session,
}: {
  session: { name: string; role: UserRole } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const role = session?.role ?? null;
  const isHome = pathname === "/";
  const isSearch = pathname === "/search";
  const inWorkspace = role === "vendor" && under(pathname, VENDOR_HOME);
  const inOnboarding = role === "vendor" && under(pathname, VENDOR_ONBOARDING);
  const initialPath = useRef(pathname);

  // Remember once the user has navigated inside the app (resets on a full load).
  useEffect(() => {
    if (pathname !== initialPath.current) navigatedInApp = true;
  }, [pathname]);

  // The admin area draws its own chrome (app/_nav/admin-shell.tsx): no
  // customer or vendor links there. An unknown /admin/* URL renders the root
  // 404 outside the admin layout, so there is no shell (QA-087): keep this
  // header then, with the admin links, so the admin isn't stranded.
  const adminArea = role === "admin" && under(pathname, ADMIN_HOME);
  const adminShellMissing = useAdminShellMissing(adminArea);
  const hidden = adminArea && !adminShellMissing;

  // --header-h is what sticky sidebars, scroll-padding-top and pop-overs
  // offset by. The header can be taller than its 64px minimum (sm padding,
  // the /search box on its own row on phones, a notch), so publish the real
  // height instead of trusting the constant (QA-062). The header's own
  // min-height is a fixed 64px so this can't feed back into itself.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = headerRef.current;
    if (!el) {
      root.style.removeProperty("--header-h");
      return;
    }
    const publish = () => root.style.setProperty("--header-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--header-h");
    };
  }, [hidden]);

  if (hidden) return null;

  function goBack() {
    let sameOriginReferrer = false;
    try {
      sameOriginReferrer =
        !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
      sameOriginReferrer = false;
    }
    if ((navigatedInApp || sameOriginReferrer) && window.history.length > 1) router.back();
    else router.push(parentRoute(pathname));
  }

  // Workspace sections are reached from the sidebar / tab bar, so Back only
  // shows on deeper workspace pages (an offering editor, a lead).
  const topLevelWorkspace = inWorkspace && VENDOR_NAV.some((i) => i.href === pathname);
  const showBack = !isHome && !topLevelWorkspace && !inOnboarding && pathname !== ADMIN_HOME;
  const logoHref = role === "vendor" ? VENDOR_HOME : role === "admin" ? ADMIN_HOME : "/";
  // On the home page the hero carries the brand; vendors and admins always
  // see the logo so the way back to their own area is obvious.
  const showLogo = !isHome || role === "vendor" || role === "admin";

  return (
    <header
      ref={headerRef}
      data-role={role ?? "public"}
      className={`sticky top-0 z-20 safe-top bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 ${
        isHome && !showLogo ? "" : "border-b border-line"
      }`}
    >
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:bg-white focus:px-3 focus:py-2 focus:rounded-md focus:shadow-pop"
      >
        Skip to content
      </a>
      <div className="page flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 sm:py-3 min-h-16">
      <div className="flex items-center gap-1 min-w-[34px] shrink-0">
        {showBack && (
          <button
            onClick={goBack}
            aria-label="Back"
            className="w-11 h-11 -ml-2.5 flex items-center justify-center rounded-full text-foreground hover:bg-surface-muted active:bg-line shrink-0 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {showLogo && (
          <Link
            href={logoHref}
            aria-label={role === "vendor" ? "Vela, workspace home" : role === "admin" ? "Vela, admin home" : "Vela home"}
            className="inline-flex items-center min-h-11 px-1 font-display text-[22px] leading-none font-semibold tracking-tight text-accent whitespace-nowrap"
          >
            Vel<span className="text-gold">a</span>
          </Link>
        )}
        {role === "vendor" && (
          // Outside the workspace the phone header shows a "Workspace" button
          // instead, so the pill only appears where there is room.
          <span className={`ml-1 ${inWorkspace ? "inline-flex" : "hidden sm:inline-flex"} items-center rounded-full bg-accent-tint text-accent-hover px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide`}>
            Workspace
          </span>
        )}
        {role === "admin" && (
          <span className="ml-1 inline-flex items-center rounded-full bg-danger text-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
            Admin
          </span>
        )}
      </div>

      {isSearch && <KeyedHeaderSearchBox />}

      {inOnboarding ? (
        // Onboarding saves every step, so leaving is always safe.
        <Link href={VENDOR_HOME} className="btn btn-secondary btn-sm">
          Save &amp; exit
        </Link>
      ) : session && role === "vendor" ? (
        <div className="flex items-center gap-1 min-w-0">
          {!inWorkspace && (
            <>
              <nav aria-label="Workspace" className="hidden lg:flex items-center gap-0.5 text-sm">
                {VENDOR_HEADER_LINKS.map((item) => (
                  <HeaderLink
                    key={item.href}
                    href={item.href}
                    label={item.short ?? item.label}
                    active={isActive(pathname, item)}
                  />
                ))}
              </nav>
              <Link href={VENDOR_HOME} className="btn btn-secondary btn-sm lg:hidden">
                Workspace
              </Link>
            </>
          )}
          <NotificationBell />
          <AccountMenu name={session.name} links={VENDOR_MENU} />
        </div>
      ) : session && role === "admin" && adminArea ? (
        // Unknown /admin/* page (QA-087): the console's main sections, on
        // their own scrollable row on phones.
        <>
          <nav
            aria-label="Admin"
            className="order-last basis-full md:order-none md:basis-auto flex items-center gap-0.5 text-sm overflow-x-auto -mx-1 px-1"
          >
            {ADMIN_NAV.filter((i) => ADMIN_404_LINKS.includes(i.href)).map((i) => (
              <HeaderLink key={i.href} href={i.href} label={i.href === ADMIN_HOME ? "Admin home" : i.label} active={false} />
            ))}
          </nav>
          <AccountMenu name={session.name} links={ADMIN_MENU} />
        </>
      ) : session && role === "admin" ? (
        <div className="flex items-center gap-1 min-w-0">
          <nav aria-label="Admin" className="hidden md:flex items-center gap-0.5 text-sm">
            {ADMIN_LINKS.map((l) => (
              <HeaderLink key={l.href} href={l.href} label={l.label} active={pathname === l.href} />
            ))}
          </nav>
          <AccountMenu name={session.name} links={ADMIN_MENU} />
        </div>
      ) : session ? (
        // Customers: no "For vendors" here (footer only). Phones get the
        // bottom tab bar (root layout) instead of these links.
        <CustomerNav name={session.name} pathname={pathname} />
      ) : (
        <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1 text-sm whitespace-nowrap min-w-0">
          {/* On /search itself the link gives its room to the search box until lg. */}
          <Link
            href="/search"
            className={`hidden ${isSearch ? "lg:inline-flex" : "md:inline-flex"} items-center min-h-11 px-3 rounded-md text-foreground hover:bg-surface-muted hover:text-accent transition-colors`}
          >
            Browse vendors
          </Link>
          <Link
            href="/for-vendors"
            className="hidden sm:inline-flex items-center min-h-11 px-3 rounded-md text-foreground hover:bg-surface-muted hover:text-accent transition-colors"
          >
            For vendors
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center min-h-11 px-2.5 sm:px-3 rounded-md text-foreground font-medium hover:bg-surface-muted hover:text-accent transition-colors"
          >
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-primary px-4 sm:px-5">
            Sign up
          </Link>
        </nav>
      )}
      </div>
    </header>
  );
}

function CustomerNav({ name, pathname }: { name: string; pathname: string }) {
  const counts = useCustomerCounts(true);
  return (
    <div className="flex items-center gap-1 min-w-0">
      <ShortlistMerge />
      <nav aria-label="Main" className="hidden lg:flex items-center gap-0.5 text-sm">
        {CUSTOMER_LINKS.map((l) => {
          const active = isActive(pathname, l);
          const n = l.badge ? counts[l.badge] : 0;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 min-h-11 px-3 rounded-md whitespace-nowrap transition-colors ${
                active ? "text-accent font-medium bg-accent-tint" : "text-foreground hover:bg-surface-muted hover:text-accent"
              }`}
            >
              {l.label}
              {n > 0 &&
                (l.badge === "enquiries" ? (
                  <span className="size-2 rounded-full bg-accent" data-testid="enquiries-dot">
                    <span className="sr-only"> ({n} new)</span>
                  </span>
                ) : (
                  <span className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-surface-muted text-xs text-ink-soft tabular-nums" data-testid="shortlist-count">
                    {n > 99 ? "99+" : n}
                    <span className="sr-only"> saved</span>
                  </span>
                ))}
            </Link>
          );
        })}
      </nav>
      <NotificationBell />
      <AccountMenu name={name} links={CUSTOMER_MENU} />
    </div>
  );
}

function HeaderLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center min-h-11 px-3 rounded-md whitespace-nowrap transition-colors ${
        active
          ? "text-accent font-medium bg-accent-tint"
          : "text-foreground hover:bg-surface-muted hover:text-accent"
      }`}
    >
      {label}
    </Link>
  );
}

// Keyed on the q param so the box re-seeds whenever the URL's query changes
// (e.g. after "Clear all" or a suggestion click) instead of going stale.
function KeyedHeaderSearchBox() {
  const searchParams = useSearchParams();
  return <HeaderSearchBox key={searchParams.get("q") ?? ""} />;
}

function HeaderSearchBox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    const q = value.trim();
    if (q) params.set("q", q);
    else params.delete("q");
    router.push(`/search?${params.toString()}`);
  }

  return (
    <form
      role="search"
      onSubmit={submit}
      className="order-last basis-full md:order-none md:basis-0 flex items-center gap-2.5 md:flex-1 max-w-full md:max-w-[520px] min-w-0 border border-line-strong bg-surface-muted rounded-full px-4 py-0 transition-colors focus-within:border-accent focus-within:bg-white focus-within:shadow-[0_0_0_3px_var(--color-accent-tint)]"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-soft shrink-0" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search vendors, categories, locations"
        aria-label="Search vendors"
        className="flex-1 min-w-0 min-h-11 outline-none text-sm bg-transparent placeholder:text-[#80868b]"
      />
    </form>
  );
}

function AccountMenu({ name, links }: { name: string; links: MenuLink[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const firstName = name.split(" ")[0] || name;
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  // Close when the route changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "flex items-center min-h-[44px] px-4 text-sm text-foreground hover:bg-surface-muted focus-visible:bg-surface-muted w-full text-left";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        className="flex items-center gap-2 min-h-[44px] pl-1 pr-2.5 rounded-full border border-transparent hover:border-line hover:bg-surface-muted aria-expanded:bg-surface-muted text-sm text-foreground transition-colors"
      >
        <span
          aria-hidden="true"
          className="w-8 h-8 rounded-full bg-accent-tint text-accent font-semibold text-xs flex items-center justify-center"
        >
          {initials || "?"}
        </span>
        <span className="hidden sm:inline whitespace-nowrap">Hi, {firstName}</span>
        <span className="sr-only sm:hidden">Account menu for {firstName}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          id="account-menu"
          role="menu"
          className="absolute right-0 top-full mt-2 w-60 max-w-[calc(100vw-2rem)] bg-white border border-line rounded-card shadow-pop py-1.5 z-30"
        >
          <div className="px-4 pt-2 pb-2.5 text-xs text-ink-soft truncate">Signed in as {name}</div>
          {links.map((l) => (
            <Link key={l.label} role="menuitem" href={l.href} className={itemClass}>
              {l.label}
            </Link>
          ))}
          <div className="border-t border-line my-1.5" />
          <LogoutButton className={itemClass} />
        </div>
      )}
    </div>
  );
}

function LogoutButton({ className }: { className: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error(`Logout failed (${res.status})`);
      router.push("/");
      router.refresh();
    } catch {
      setError("Couldn't log out. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <>
      <button
        role="menuitem"
        type="button"
        onClick={handleLogout}
        disabled={pending}
        aria-busy={pending}
        className={`${className} disabled:opacity-60`}
      >
        {pending ? "Logging out…" : "Log out"}
      </button>
      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}
