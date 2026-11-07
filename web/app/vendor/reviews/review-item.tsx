"use client";

import Link from "next/link";
import { useState } from "react";
import ReplyForm from "./reply-form";
import type { VendorReviewItem } from "@/lib/vendor-reviews";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span role="img" className="text-gold tracking-tight" aria-label={`${r} out of 5 stars`}>
      <span aria-hidden="true">{"★".repeat(r)}</span>
      <span aria-hidden="true" className="text-line-strong">
        {"★".repeat(5 - r)}
      </span>
    </span>
  );
}

export default function ReviewItem({ r }: { r: VendorReviewItem }) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  return (
    <li className="card" id={`review-${r.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-medium text-foreground">
          {r.reviewerName}
          {r.verified && <span className="chip ml-2 align-middle bg-accent-tint text-accent-hover">Verified booking</span>}
          {r.hidden && <span className="chip ml-2 align-middle">Hidden by Vela</span>}
        </p>
        <time dateTime={r.createdAt} className="text-caption text-ink-soft">
          {dateFmt.format(new Date(r.createdAt))}
        </time>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-caption text-ink-soft">
        <Stars rating={r.rating} />
        {r.eventType && <span>· {r.eventType}</span>}
        {r.enquiryId && (
          <>
            <span aria-hidden="true">·</span>
            <Link
              href={`/vendor/leads/${r.enquiryId}`}
              className="inline-flex items-center min-h-11 -my-3 text-accent underline-offset-2 hover:underline"
            >
              View enquiry
            </Link>
          </>
        )}
      </div>
      <p className="text-body text-foreground mt-2 whitespace-pre-line">{r.body}</p>

      {r.reply && !editing ? (
        <div className="mt-3 rounded-control bg-surface-muted px-3.5 py-3">
          <p className="text-caption font-semibold text-foreground">
            Your reply
            <span className="font-normal text-ink-soft">
              {" "}
              · {dateFmt.format(new Date(r.replyAt!))}
              {r.replyEditedAt ? " (edited)" : ""}
            </span>
          </p>
          <p className="text-body mt-1 whitespace-pre-line">{r.reply}</p>
          {r.replyEditable && !r.hidden && (
            <button type="button" className="btn btn-ghost btn-sm -ml-3.5 mt-1" onClick={() => setEditing(true)}>
              Edit reply
            </button>
          )}
        </div>
      ) : r.reply && editing ? (
        <ReplyForm reviewId={r.id} initial={r.reply} mode="edit" onDone={() => setEditing(false)} />
      ) : r.hidden ? null : replying ? (
        <ReplyForm reviewId={r.id} mode="create" />
      ) : (
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setReplying(true)}>
          Reply publicly
        </button>
      )}
    </li>
  );
}
