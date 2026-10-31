import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage } from "@/app/admin/_components/admin-page";
import { listMediaQueue, parseMediaTab, type MediaQueue, type MediaTab } from "@/lib/admin/moderation";
import MediaQueueGrid from "./_components/media-queue";

export const metadata: Metadata = { title: "Media" };

const TABS: { id: MediaTab; label: string; blurb: string }[] = [
  {
    id: "pre",
    label: "Pre-moderation",
    blurb: "Photos and videos from listings that are not live yet. Approving the listing also approves these, so reject anything unsuitable first.",
  },
  {
    id: "recent",
    label: "Recently uploaded",
    blurb: "Uploads from live vendors in the last 14 days. They are already public: spot-check and mark them fine, or take them down.",
  },
  {
    id: "reported",
    label: "Reported",
    blurb: "Media that visitors reported. Two reports take an item off the public profile until you decide.",
  },
];

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const sp = await searchParams;
  const tab = parseMediaTab(sp.tab);
  const page = Math.max(1, Number(sp.page) || 1);
  let queue: MediaQueue | null = null;
  try {
    queue = await listMediaQueue(tab, page);
  } catch (err) {
    console.error("admin media queue", err);
  }
  const current = TABS.find((t) => t.id === tab)!;
  const pages = queue ? Math.max(1, Math.ceil(queue.total / queue.pageSize)) : 1;

  return (
    <AdminPage title="Media" description="Check what vendors upload before and after it goes public.">
      <nav aria-label="Media queues" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((t) => {
            const active = t.id === tab;
            const n = queue?.counts[t.id];
            return (
              <li key={t.id}>
                <Link
                  href={`/admin/media?tab=${t.id}`}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors ${
                    active ? "border-accent text-accent-hover" : "border-transparent text-ink-soft hover:text-foreground"
                  }`}
                >
                  {t.label}
                  {typeof n === "number" ? (
                    <span
                      className={`rounded-full px-2 text-xs leading-5 tabular-nums ${
                        active ? "bg-accent-tint text-accent-hover" : "bg-surface-muted text-ink-soft"
                      }`}
                    >
                      {n}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <p className="mt-3 max-w-prose text-body text-ink-soft">{current.blurb}</p>

      <div className="mt-5">
        {!queue ? (
          <div className="alert-error max-w-xl" role="alert">
            Could not load the media queue. Refresh the page to try again.
          </div>
        ) : (
          <MediaQueueGrid key={`${tab}-${page}`} tab={tab} items={queue.items} />
        )}
      </div>

      {queue && pages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link className="btn btn-secondary" href={`/admin/media?tab=${tab}&page=${page - 1}`}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-caption text-ink-soft tabular-nums">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link className="btn btn-secondary" href={`/admin/media?tab=${tab}&page=${page + 1}`}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </AdminPage>
  );
}
