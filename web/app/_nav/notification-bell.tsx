"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InAppNotification } from "@/lib/notifications";

// Header bell (PRODUCT_PLAN P2-13): vendors (new lead, customer messages and
// offer replies, admin decisions) and customers (offers, messages, booking
// updates). Reads /api/notifications; the count refreshes on navigation,
// when the tab regains focus and once a minute while visible.

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} d ago`;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

export default function NotificationBell() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InAppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=15", { cache: "no-store" });
      if (res.status === 403) {
        // Suspended while signed in (QA-056): the session is gone now; show
        // the sign-in page with the admin's reason instead of a dead bell.
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === "SUSPENDED") {
          // A full load on purpose: the whole signed-in shell must go.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login?suspended=1");
          return;
        }
      }
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { items: InAppNotification[]; unread: number };
      setItems(data.items);
      setUnread(data.unread);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  // Refresh on every navigation (opening a thread marks its notifications read).
  useEffect(() => {
    // Deferred a tick so the fetch never blocks the navigation's render.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [pathname, load]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") load();
    };
    const t = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  // Close on route change.
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

  async function mark(body: { ids: number[] } | { all: true }) {
    // Optimistic: the server only changes the caller's own rows.
    const ids = "ids" in body ? new Set(body.ids) : null;
    const now = new Date().toISOString();
    setItems((xs) => xs?.map((n) => (n.readAt || (ids && !ids.has(n.id)) ? n : { ...n, readAt: now })) ?? xs);
    setUnread((u) => (ids ? Math.max(0, u - [...ids].filter((id) => items?.some((n) => n.id === id && !n.readAt)).length) : 0));
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (!res.ok) throw new Error();
    } catch {
      load();
    }
  }

  async function markAll() {
    setBusy(true);
    await mark({ all: true });
    setBusy(false);
  }

  const label = unread ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-label={label}
        data-testid="notification-bell"
        className="relative w-11 h-11 flex items-center justify-center rounded-full text-foreground hover:bg-surface-muted aria-expanded:bg-surface-muted transition-colors"
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden="true"
            data-testid="notification-count"
            className="absolute top-1 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[11px] font-semibold leading-[18px] text-center tabular-nums"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id="notification-panel"
          role="dialog"
          aria-label="Notifications"
          className="fixed left-2 right-2 top-[calc(var(--header-h)+4px)] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 max-h-[min(70vh,520px)] flex flex-col bg-white border border-line rounded-card shadow-pop z-30"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-line">
            <h2 className="text-[15px] font-semibold">Notifications</h2>
            {unread > 0 && (
              <button type="button" onClick={markAll} disabled={busy} className="inline-flex items-center min-h-11 px-2 -mr-2 text-[13px] font-medium text-accent hover:underline disabled:opacity-60">
                Mark all read
              </button>
            )}
          </div>
          <div className="overflow-y-auto overscroll-contain">
            {items === null ? (
              error ? (
                <p className="px-4 py-6 text-body text-danger">Couldn&apos;t load notifications. Check your connection.</p>
              ) : (
                <p className="px-4 py-6 text-body text-ink-soft" aria-busy="true">
                  Loading…
                </p>
              )
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-body text-ink-soft">You&apos;re all caught up. Replies, offers and updates will show up here.</p>
            ) : (
              <ul>
                {items.map((n) => {
                  const inner = (
                    <>
                      <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`} />
                      <span className="min-w-0">
                        <span className={`block text-body leading-snug ${n.readAt ? "" : "font-semibold"}`}>
                          {n.title}
                          {!n.readAt && <span className="sr-only"> (unread)</span>}
                        </span>
                        {n.body && <span className="block text-caption text-ink-soft mt-0.5 line-clamp-2 break-words">{n.body}</span>}
                        <span className="block text-caption text-ink-soft mt-0.5">{when(n.createdAt)}</span>
                      </span>
                    </>
                  );
                  const cls = "flex gap-3 px-4 py-3 min-h-11 border-b border-line last:border-b-0 hover:bg-surface-muted text-left w-full";
                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link href={n.link} className={cls} onClick={() => !n.readAt && mark({ ids: [n.id] })}>
                          {inner}
                        </Link>
                      ) : (
                        <button type="button" className={cls} onClick={() => !n.readAt && mark({ ids: [n.id] })}>
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
