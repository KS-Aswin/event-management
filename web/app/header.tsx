"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { UserRole } from "@/lib/db";

// Where the Back button goes when there is no in-app history to return to
// (page opened from a shared link, bookmark or new tab).
let navigatedInApp = false;

function parentRoute(pathname: string): string {
  if (pathname.startsWith("/vendors/")) return "/search";
  if (pathname.startsWith("/dashboard/")) return "/dashboard";
  return "/";
}

export default function Header({
  session,
}: {
  session: { name: string; role: UserRole } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";
  const isSearch = pathname === "/search";
  const initialPath = useRef(pathname);

  // Remember once the user has navigated inside the app (resets on a full load).
  useEffect(() => {
    if (pathname !== initialPath.current) navigatedInApp = true;
  }, [pathname]);

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

  return (
    <header
      className={`sticky top-0 z-20 safe-top bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 ${
        isHome ? "" : "border-b border-line"
      }`}
    >
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:bg-white focus:px-3 focus:py-2 focus:rounded-md focus:shadow-pop"
      >
        Skip to content
      </a>
      <div className="page flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 sm:py-3 min-h-[var(--header-h)]">
      <div className="flex items-center gap-1 min-w-[34px] shrink-0">
        {!isHome && (
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
        {!isHome && (
          <Link href="/" className="inline-flex items-center min-h-11 px-1 font-display text-[22px] leading-none font-semibold tracking-tight text-accent whitespace-nowrap">
            Vel<span className="text-gold">a</span>
          </Link>
        )}
      </div>

      {isSearch && <KeyedHeaderSearchBox />}

      {session ? (
        <AccountMenu name={session.name} role={session.role} />
      ) : (
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2 text-sm whitespace-nowrap min-w-0">
          <Link
            href="/for-vendors"
            className="hidden min-[360px]:inline-flex items-center min-h-11 px-2.5 sm:px-3 rounded-md text-foreground hover:bg-surface-muted hover:text-accent transition-colors"
          >
            List your business
          </Link>
          <Link href="/login" className="btn btn-primary px-4 sm:px-5">
            Sign in
          </Link>
        </nav>
      )}
      </div>
    </header>
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
      className="order-last basis-full md:order-none md:basis-auto flex items-center gap-2.5 md:flex-1 max-w-full md:max-w-[520px] min-w-0 border border-line-strong bg-surface-muted rounded-full px-4 py-0 transition-colors focus-within:border-accent focus-within:bg-white focus-within:shadow-[0_0_0_3px_var(--color-accent-tint)]"
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

function AccountMenu({ name, role }: { name: string; role: UserRole }) {
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
          <Link role="menuitem" href="/dashboard" className={itemClass}>
            {role === "vendor" ? "Dashboard & leads" : "Dashboard, quotes & favourites"}
          </Link>
          <Link role="menuitem" href="/settings" className={itemClass}>
            Settings
          </Link>
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
        {pending ? "Logging out…" : "Logout"}
      </button>
      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}
