"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { InAppNotification } from "@/lib/notifications";

const DATE_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/**
 * "2 min ago" style label. `now` is null during the server render and
 * hydration (QA-077): relative times depend on the clock, so the server
 * prints the date and the client switches to the relative label after mount.
 */
function when(iso: string, now: number | null): string {
  const d = new Date(iso);
  if (now === null) return DATE_FMT.format(d);
  const mins = Math.round((now - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return DATE_FMT.format(d);
}

// A clock that ticks every 30 s on the client and is null on the server.
const TICK_MS = 30_000;
function subscribeClock(cb: () => void) {
  const t = setInterval(cb, TICK_MS);
  return () => clearInterval(t);
}
const clockSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const serverClock = () => null;

/**
 * Vendor home "Updates from Vela": admin decisions (approval, requested
 * changes, rejected photos, hidden reviews, custom offering outcomes) with
 * mark-as-read. Reads and writes go through /api/notifications.
 */
export default function NotificationsList({
  initialItems,
  initialUnread,
}: {
  initialItems: InAppNotification[];
  initialUnread: number;
}) {
  const router = useRouter();
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, serverClock);
  const [items, setItems] = useState(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark(body: { ids: number[] } | { all: true }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const readAt = new Date().toISOString();
      const ids = "ids" in body ? new Set(body.ids) : null;
      const changed = items.filter((n) => !n.readAt && (!ids || ids.has(n.id))).length;
      setItems(items.map((n) => (n.readAt || (ids && !ids.has(n.id)) ? n : { ...n, readAt })));
      setUnread((u) => ("all" in body ? 0 : Math.max(0, u - changed)));
      router.refresh();
    } catch {
      setError("Could not update. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="updates-h" data-testid="vendor-notifications">
      <div className="flex items-center justify-between gap-2">
        <h2 id="updates-h" className="text-title font-semibold">
          Updates from Vela
          {unread > 0 ? (
            <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-caption font-semibold text-white align-middle">
              {unread}
              <span className="sr-only"> unread</span>
            </span>
          ) : null}
        </h2>
        {unread > 0 ? (
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void mark({ all: true })}>
            Mark all read
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="alert-error mt-2">
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-2 text-body text-ink-soft">No updates yet. Decisions from our team about your listing show up here.</p>
      ) : (
        <ul className="mt-1">
          {items.map((n) => (
            <li key={n.id} className="border-b border-line py-2.5 last:border-b-0" data-unread={n.readAt ? undefined : "1"}>
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`mt-2 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-body ${n.readAt ? "text-foreground/85" : "font-semibold"}`}>
                    {n.link ? (
                      <Link href={n.link} className="hover:text-accent hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                    {n.readAt ? null : <span className="sr-only"> (unread)</span>}
                  </p>
                  {n.body ? <p className="mt-0.5 whitespace-pre-line break-words text-caption text-ink-soft">{n.body}</p> : null}
                  <p className="mt-0.5 text-caption text-ink-soft">
                    <time dateTime={n.createdAt} suppressHydrationWarning>
                      {when(n.createdAt, now)}
                    </time>
                  </p>
                </div>
                {n.readAt ? null : (
                  <button
                    type="button"
                    className="-mr-2 inline-flex min-h-11 shrink-0 items-center rounded-control px-2 text-caption font-medium text-accent hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void mark({ ids: [n.id] })}
                    aria-label={`Mark "${n.title}" as read`}
                  >
                    Mark read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
