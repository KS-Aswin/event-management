"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ADMIN_NAV, type NavItem } from "./config";
import { ADMIN_HOME } from "./routes";
import NavIcon from "./nav-icon";

// Admin area frame (PRODUCT_PLAN 2.5, 2.7): its own top bar, a sidebar from
// lg up and a slide-down menu on phones. The public header and footer hide
// themselves on /admin, so no customer or vendor links show here.

/** The nav item for pathname: the longest matching href wins. */
function activeHref(pathname: string): string | null {
  let best: NavItem | null = null;
  for (const item of ADMIN_NAV) {
    const hit = item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/");
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.href ?? null;
}

export default function AdminShell({ name, children }: { name: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the phone menu on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !menuButtonRef.current?.contains(t)) setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen]);

  const currentLabel = ADMIN_NAV.find((i) => i.href === current)?.label ?? "Admin";

  return (
    <div className="flex-1 flex flex-col min-w-0" data-admin-shell>
      <header className="sticky top-0 z-20 safe-top bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 border-b border-line">
        <a
          href="#admin-main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:bg-white focus:px-3 focus:py-2 focus:rounded-md focus:shadow-pop"
        >
          Skip to content
        </a>
        <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 flex items-center justify-between gap-3 min-h-[var(--header-h)]">
          <div className="flex items-center gap-1 min-w-0">
            <Link
              href={ADMIN_HOME}
              aria-label="Vela, admin home"
              className="inline-flex items-center min-h-11 px-1 font-display text-[22px] leading-none font-semibold tracking-tight text-accent whitespace-nowrap"
            >
              Vel<span className="text-gold">a</span>
            </Link>
            <span className="ml-1 inline-flex items-center rounded-full bg-danger text-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              Admin
            </span>
            <span className="lg:hidden ml-2 text-sm text-ink-soft truncate" aria-hidden="true">
              {currentLabel}
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2 min-h-11 px-3 rounded-control text-sm text-foreground hover:bg-surface-muted hover:text-accent transition-colors"
            >
              <NavIcon name="external" size={18} />
              View site
            </Link>
            <span className="text-sm text-ink-soft px-2 max-w-[220px] truncate" title={name}>
              {name}
            </span>
            <SignOutButton className="btn btn-secondary btn-sm" />
          </div>

          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            className="lg:hidden inline-flex items-center gap-2 min-h-11 px-3 -mr-2 rounded-control text-sm font-medium text-foreground hover:bg-surface-muted"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {menuOpen ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
            Menu
          </button>
        </div>

        {menuOpen && (
          <div
            ref={menuRef}
            id={menuId}
            className="lg:hidden border-t border-line bg-white max-h-[calc(100dvh-var(--header-h))] overflow-y-auto"
          >
            <nav aria-label="Admin" className="px-2 py-2">
              <ul className="flex flex-col gap-0.5">
                {ADMIN_NAV.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} active={item.href === current} />
                  </li>
                ))}
              </ul>
            </nav>
            <div className="border-t border-line px-2 py-2 flex flex-col gap-0.5">
              <p className="px-3 py-1 text-xs text-ink-soft truncate">Signed in as {name}</p>
              <Link
                href="/"
                className="flex items-center gap-3 min-h-12 px-3 rounded-control text-[15px] text-foreground hover:bg-surface-muted"
              >
                <NavIcon name="external" />
                View site
              </Link>
              <SignOutButton
                className="flex items-center gap-3 min-h-12 px-3 rounded-control text-[15px] text-foreground hover:bg-surface-muted w-full text-left"
                withIcon
              />
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 flex w-full max-w-[1440px] mx-auto min-w-0">
        <aside className="hidden lg:block w-60 shrink-0 border-r border-line">
          <nav aria-label="Admin" className="sticky top-[var(--header-h)] px-3 py-5">
            <p className="eyebrow px-3 pb-2">Moderation</p>
            <ul className="flex flex-col gap-0.5">
              {ADMIN_NAV.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={item.href === current} />
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        {/* Pages render their own <main> (see app/admin/_components/admin-page.tsx). */}
        <div id="admin-main" tabIndex={-1} className="flex-1 min-w-0 flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 min-h-11 px-3 rounded-control text-sm transition-colors ${
        active
          ? "bg-accent-tint text-accent-hover font-medium"
          : "text-foreground hover:bg-surface-muted hover:text-accent"
      }`}
    >
      <NavIcon name={item.icon} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SignOutButton({ className, withIcon = false }: { className: string; withIcon?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      router.push("/");
      router.refresh();
    } catch {
      setError("Couldn't sign out. Try again.");
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={signOut} disabled={pending} aria-busy={pending} className={`${className} disabled:opacity-60`}>
        {withIcon && <NavIcon name="logout" />}
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && (
        <p role="alert" className="px-3 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}
