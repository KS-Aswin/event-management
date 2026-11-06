import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveLiveSession } from "@/app/api/_lib/auth";
import { homeFor } from "@/app/_nav/routes";
import { listNotifications } from "@/lib/notifications";
import NotificationFeed, { type FeedItem } from "./notification-feed";

export const metadata: Metadata = { title: "Notifications" };

// Every notification the signed-in user has (QA-095). The header bell lists
// the newest 15 and the vendor home the newest 6; this page pages through
// all of them, shows each in full (admin decision notes included) and marks
// them read one by one or all at once. Any signed-in role.

const PER_PAGE = 20;
const WHEN = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function pageHref(page: number, unreadOnly: boolean): string {
  const q = new URLSearchParams();
  if (unreadOnly) q.set("filter", "unread");
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/notifications?${s}` : "/notifications";
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const live = await resolveLiveSession();
  if (live.state === "suspended") redirect("/login?suspended=1");
  if (live.state !== "ok") redirect(`/login?next=${encodeURIComponent("/notifications")}`);
  const { session } = live;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const unreadOnly = one(sp.filter) === "unread";
  const requested = Math.max(1, Math.floor(Number(one(sp.page))) || 1);

  let page = requested;
  let data = await listNotifications(session.userId, PER_PAGE, { offset: (page - 1) * PER_PAGE, unreadOnly });
  const pages = Math.max(1, Math.ceil(data.total / PER_PAGE));
  if (page > pages) {
    // Past the end (e.g. everything on the last page was just marked read).
    page = pages;
    data = await listNotifications(session.userId, PER_PAGE, { offset: (page - 1) * PER_PAGE, unreadOnly });
  }
  const items: FeedItem[] = data.items.map((n) => ({ ...n, when: WHEN.format(new Date(n.createdAt)) }));
  const first = data.total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const last = (page - 1) * PER_PAGE + items.length;
  const back =
    session.role === "vendor" ? "Back to your workspace" : session.role === "admin" ? "Back to admin" : "Back to your account";

  const tab = (active: boolean) =>
    `inline-flex items-center min-h-11 px-4 rounded-full border text-body font-medium transition-colors ${
      active ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong hover:bg-surface-muted"
    }`;

  return (
    <main className="page-narrow py-6 sm:py-10">
      <p className="mb-2">
        <Link href={homeFor(session.role)} className="inline-flex items-center gap-1 min-h-11 text-body text-ink-soft hover:text-accent hover:underline">
          <span aria-hidden="true">←</span>
          {back}
        </Link>
      </p>
      <header className="mb-4">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Notifications</h1>
        <p className="text-body text-ink-soft mt-1">
          {data.unread > 0 ? `${data.unread} unread. ` : "You're all caught up. "}
          Updates from Vela, replies and offers, newest first.
        </p>
      </header>

      <nav aria-label="Filter notifications" className="flex flex-wrap gap-2 mb-4">
        <Link href={pageHref(1, false)} className={tab(!unreadOnly)} aria-current={!unreadOnly ? "page" : undefined}>
          All
        </Link>
        <Link href={pageHref(1, true)} className={tab(unreadOnly)} aria-current={unreadOnly ? "page" : undefined}>
          Unread{data.unread > 0 ? ` (${data.unread})` : ""}
        </Link>
      </nav>

      <NotificationFeed
        key={`${unreadOnly ? "u" : "a"}-${page}-${items.map((n) => `${n.id}${n.readAt ? "r" : ""}`).join(",")}`}
        items={items}
        unread={data.unread}
        unreadOnly={unreadOnly}
      />

      {data.total > 0 && (
        <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-caption text-ink-soft" data-testid="notifications-range">
            {first}–{last} of {data.total}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={pageHref(page - 1, unreadOnly)} className="btn btn-secondary" rel="prev">
                ← Newer
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={pageHref(page + 1, unreadOnly)} className="btn btn-secondary" rel="next" data-testid="notifications-older">
                Older →
              </Link>
            ) : null}
          </div>
        </nav>
      )}
    </main>
  );
}
