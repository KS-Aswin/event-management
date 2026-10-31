import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage } from "@/app/admin/_components/admin-page";
import { listReviewQueue, parseReviewTab, type ReviewQueue, type ReviewTab } from "@/lib/admin/moderation";
import ReviewQueueList from "./_components/review-queue";

export const metadata: Metadata = { title: "Reviews" };

const TABS: { id: ReviewTab; label: string; blurb: string }[] = [
  {
    id: "open",
    label: "Open reports",
    blurb: "Reviews that someone reported. Hide a review that breaks the policy (fake, abusive, contact details, discrimination), or keep it and dismiss the reports.",
  },
  {
    id: "hidden",
    label: "Hidden",
    blurb: "Reviews taken off public pages. They don't count towards the vendor's rating. Unhide one if it was hidden by mistake.",
  },
];

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = parseReviewTab((await searchParams).tab);
  let queue: ReviewQueue | null = null;
  try {
    queue = await listReviewQueue(tab);
  } catch (err) {
    console.error("admin review queue", err);
  }
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <AdminPage title="Reviews" description="Keep reviews honest without silencing real customers.">
      <nav aria-label="Review queues" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((t) => {
            const active = t.id === tab;
            const n = queue?.counts[t.id];
            return (
              <li key={t.id}>
                <Link
                  href={`/admin/reviews?tab=${t.id}`}
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
            Could not load the review queue. Refresh the page to try again.
          </div>
        ) : (
          <ReviewQueueList key={tab} tab={tab} items={queue.items} />
        )}
      </div>
    </AdminPage>
  );
}
