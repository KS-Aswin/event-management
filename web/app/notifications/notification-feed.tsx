"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InAppNotification } from "@/lib/notifications";

export type FeedItem = InAppNotification & { when: string };

/**
 * One page of /notifications (QA-095): every item in full, with its link
 * (opening it marks it read) and a "Mark read" button; "Mark all read" on
 * top. Writes go through /api/notifications; the page re-renders after.
 */
export default function NotificationFeed({
  items: initialItems,
  unread: initialUnread,
  unreadOnly,
}: {
  items: FeedItem[];
  unread: number;
  unreadOnly: boolean;
}) {
  const router = useRouter();
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
      setItems((xs) => xs.map((n) => (n.readAt || (ids && !ids.has(n.id)) ? n : { ...n, readAt })));
      setUnread((u) => (ids ? Math.max(0, u - changed) : 0));
      router.refresh();
    } catch {
      setError("Could not update. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function openItem(n: FeedItem) {
    if (n.readAt) return;
    // keepalive: the request outlives the navigation the link starts.
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [n.id] }),
      keepalive: true,
    }).catch(() => {});
  }

  return (
    <section className="card p-0 overflow-hidden" aria-label="Notification list" data-testid="notifications-feed">
      {unread > 0 ? (
        <div className="flex items-center justify-end gap-2 px-2 border-b border-line">
          <button
            type="button"
            className="inline-flex items-center min-h-11 px-2 text-body font-medium text-accent hover:underline disabled:opacity-60"
            disabled={busy}
            onClick={() => void mark({ all: true })}
          >
            Mark all read
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="alert-error m-4">
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="px-4 py-10 text-center text-body text-ink-soft">
          {unreadOnly ? "No unread notifications." : "No notifications yet. Replies, offers and updates from Vela will show up here."}
        </p>
      ) : (
        <ul>
          {items.map((n) => {
            const title = (
              <span>
                {n.title}
                {n.readAt ? null : <span className="sr-only"> (unread)</span>}
              </span>
            );
            return (
              <li
                key={n.id}
                className={`flex items-start gap-3 px-4 pt-1 pb-3 border-b border-line last:border-b-0 ${n.readAt ? "" : "bg-accent-tint"}`}
                data-testid="notification-item"
                data-unread={n.readAt ? undefined : "1"}
              >
                <span aria-hidden="true" className={`mt-[18px] size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`} />
                <div className="min-w-0 flex-1">
                  <h2 className={`text-body leading-snug ${n.readAt ? "font-medium" : "font-semibold"}`}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => openItem(n)} className="flex min-h-11 items-center py-1 hover:text-accent hover:underline">
                        {title}
                      </Link>
                    ) : (
                      <span className="flex min-h-11 items-center py-1">{title}</span>
                    )}
                  </h2>
                  {n.body ? <p className="whitespace-pre-line break-words text-body text-foreground/85">{n.body}</p> : null}
                  <p className="mt-1 text-caption text-ink-soft">
                    <time dateTime={n.createdAt}>{n.when}</time>
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
