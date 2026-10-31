"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReviewQueueItem, ReviewTab } from "@/lib/admin/moderation";
import { AdminEmptyState } from "@/app/admin/_components/admin-page";
import { postAdmin, ReasonDialog, type ReasonRequest } from "@/app/admin/media/_components/reason-dialog";

const HIDE_PRESETS = [
  "Fake or not a real customer",
  "Abusive or hateful language",
  "Contains phone numbers or contact details",
  "Communal or caste discrimination",
  "About a different business",
];

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${rating} out of 5 stars`}>
      <span aria-hidden="true" className="tracking-tight text-gold">
        {"★".repeat(rating)}
        <span className="text-line-strong">{"★".repeat(5 - rating)}</span>
      </span>
    </span>
  );
}

export default function ReviewQueueList({ tab, items: initial }: { tab: ReviewTab; items: ReviewQueueItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [dialog, setDialog] = useState<ReasonRequest | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function finish(item: ReviewQueueItem, url: string, body: Record<string, unknown>, done: (d: Record<string, unknown>) => string) {
    const r = await postAdmin(url, body);
    if (!r.ok && r.status !== 409 && r.status !== 404) return r.error;
    setItems((list) => list.filter((x) => x.reviewId !== item.reviewId));
    setMessage(r.ok ? { kind: "ok", text: done(r.data) } : { kind: "error", text: `${r.error} The list has been refreshed.` });
    router.refresh();
    return null;
  }

  function ratingText(d: Record<string, unknown>) {
    const v = d.vendorRating as { rating?: string; reviewsCount?: number } | undefined;
    return v ? ` Rating is now ${Number(v.rating).toFixed(1)} from ${v.reviewsCount} reviews.` : "";
  }

  function hide(item: ReviewQueueItem) {
    setDialog({
      title: "Hide this review?",
      description: `It disappears from ${item.vendor.name}'s public page and stops counting towards their rating. The reporters' reports are marked as actioned.`,
      confirmLabel: "Hide review",
      danger: true,
      presets: HIDE_PRESETS,
      onConfirm: (reason) =>
        finish(item, `/api/admin/reviews/${item.reviewId}/hide`, { reason }, (d) => `Review hidden.${ratingText(d)}`),
    });
  }

  function keep(item: ReviewQueueItem) {
    const first = item.reports[0];
    if (!first) return;
    setDialog({
      title: "Keep this review?",
      description: `The review stays public and ${item.reports.length === 1 ? "the report is" : `all ${item.reports.length} reports are`} dismissed.`,
      confirmLabel: "Keep and dismiss",
      required: false,
      onConfirm: (note) =>
        finish(item, `/api/admin/reports/${first.id}/dismiss`, { scope: "review", note: note || undefined }, () => "Reports dismissed. The review stays up."),
    });
  }

  function unhide(item: ReviewQueueItem) {
    setDialog({
      title: "Show this review again?",
      description: `It goes back on ${item.vendor.name}'s public page and counts towards their rating again.`,
      confirmLabel: "Unhide review",
      required: false,
      onConfirm: (note) =>
        finish(item, `/api/admin/reviews/${item.reviewId}/unhide`, { reason: note || undefined }, (d) => `Review is public again.${ratingText(d)}`),
    });
  }

  return (
    <>
      <div aria-live="polite">
        {message ? (
          <div className={`${message.kind === "ok" ? "alert-success" : "alert-error"} mb-4 flex items-start justify-between gap-3`}>
            <span>{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="shrink-0 font-medium underline underline-offset-2">
              Dismiss
            </button>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <AdminEmptyState
          title={tab === "open" ? "No open reports" : "No hidden reviews"}
          body={tab === "open" ? "When someone reports a review, it shows up here." : "Reviews you hide will be listed here."}
        />
      ) : (
        <ul className="grid max-w-4xl gap-4" data-testid="review-queue">
          {items.map((item) => (
            <li key={item.reviewId} className="card min-w-0" data-review-id={item.reviewId}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-caption text-ink-soft">
                    Review of{" "}
                    <Link href={`/admin/vendors/${item.vendor.id}`} className="font-medium text-foreground hover:underline">
                      {item.vendor.name}
                    </Link>{" "}
                    · rated {Number(item.vendor.rating).toFixed(1)} from {item.vendor.reviewsCount}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Stars rating={item.rating} />
                    <span className="font-medium">{item.reviewerName}</span>
                    {item.verified ? <span className="chip bg-accent-tint text-accent-hover">Sent an enquiry</span> : null}
                    <span className="text-caption text-ink-soft">{when(item.createdAt)}</span>
                  </div>
                </div>
              </div>

              <blockquote className="mt-3 whitespace-pre-line break-words border-l-2 border-line-strong pl-3 text-body">{item.body}</blockquote>

              {tab === "hidden" && item.hiddenAt ? (
                <p className="mt-3 text-caption text-ink-soft">
                  Hidden {when(item.hiddenAt)}
                  {item.hiddenReason ? (
                    <>
                      : <span className="text-foreground">{item.hiddenReason}</span>
                    </>
                  ) : null}
                </p>
              ) : null}

              {item.reports.length ? (
                <div className={`mt-3 rounded-control p-3 ${tab === "open" ? "bg-danger-tint/60" : "bg-surface-muted"}`}>
                  <p className={`text-caption font-semibold ${tab === "open" ? "text-danger" : "text-ink-soft"}`}>
                    {tab === "open"
                      ? `${item.reports.length} open report${item.reports.length === 1 ? "" : "s"}`
                      : `${item.reports.length} report${item.reports.length === 1 ? "" : "s"}`}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {item.reports.map((r) => (
                      <li key={r.id} className="text-caption">
                        “{r.reason}”{" "}
                        <span className="text-ink-soft">
                          · {r.reporter ?? "Visitor"} · {when(r.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                {tab === "open" ? (
                  <>
                    <button type="button" className="btn bg-danger text-white hover:bg-[#8f1f18]" onClick={() => hide(item)}>
                      Hide review
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => keep(item)}>
                      Keep review
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => unhide(item)}>
                    Unhide review
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ReasonDialog request={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
