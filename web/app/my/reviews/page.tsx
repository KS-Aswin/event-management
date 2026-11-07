import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/app/api/_lib/auth";
import { listMyReviews, listReviewPrompts } from "@/lib/customer-home";
import { formatDate } from "@/app/vendor/leads/format";
import { getCategoryLabeller } from "@/lib/taxonomy";

export const metadata: Metadata = { title: "My reviews" };

// Customer reviews (PRODUCT_PLAN 2.3): "rate your vendor" prompts for
// accepted or booked enquiries whose event has passed (these reviews count
// as verified, 9 #20), then the reviews already written.

export default async function MyReviewsPage() {
  const { session } = await requirePageRole("customer");
  const [reviews, prompts, categoryLabel] = await Promise.all([
    listMyReviews(session.userId),
    listReviewPrompts(session.userId),
    getCategoryLabeller(),
  ]);

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-5">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">My reviews</h1>
        <p className="text-ink-soft text-lead mt-1 max-w-[62ch]">
          Your reviews help other families choose. Reviews of vendors you booked through Vela are marked verified.
        </p>
      </header>

      <section aria-labelledby="pending-heading" className="mb-8">
        <h2 id="pending-heading" className="text-title font-semibold mb-2">
          Rate your vendors{prompts.length ? ` · ${prompts.length}` : ""}
        </h2>
        {prompts.length === 0 ? (
          <p className="card text-body text-ink-soft">
            Nothing to rate right now. After an event you booked through Vela, the vendor shows up here.
          </p>
        ) : (
          <ul className="card p-0 divide-y divide-line">
            {prompts.map((p) => (
              <li key={p.vendorId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold">{p.vendorName}</h3>
                  <p className="text-caption text-ink-soft mt-0.5">
                    {categoryLabel(p.category)}
                    {p.eventTypeName ? ` · ${p.eventTypeName}` : ""} · {formatDate(p.eventDate)} ·{" "}
                    {p.status === "booked" ? "Booked" : "Offer accepted"}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link href={`/my/enquiries/${p.enquiryId}`} className="btn btn-ghost btn-sm">
                    Enquiry
                  </Link>
                  <Link href={`/vendors/${p.vendorId}#reviews-heading`} className="btn btn-primary btn-sm">
                    Write a review
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="written-heading">
        <h2 id="written-heading" className="text-title font-semibold mb-2">
          Reviews you wrote{reviews.length ? ` · ${reviews.length}` : ""}
        </h2>
        {reviews.length === 0 ? (
          <div className="card py-8 text-center">
            <p className="text-body text-ink-soft">You haven&apos;t written any reviews yet.</p>
            <Link href="/my/enquiries" className="btn btn-secondary mt-3">
              See your enquiries
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {reviews.map((r) => (
              <li key={r.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold">
                      {r.vendorAvailable ? (
                        <Link href={`/vendors/${r.vendorId}#reviews-heading`} className="hover:underline underline-offset-2 hover:text-accent">
                          {r.vendorName}
                        </Link>
                      ) : (
                        r.vendorName
                      )}
                    </h3>
                    <p className="text-caption text-ink-soft mt-0.5">
                      <time dateTime={r.createdAt}>{formatDate(r.createdAt)}</time>
                      {r.verified ? " · Verified booking" : ""}
                    </p>
                  </div>
                  <span role="img" aria-label={`${r.rating} out of 5 stars`} className="text-gold shrink-0 tracking-[0.05em]">
                    {"★".repeat(r.rating)}
                    <span className="text-line-strong">{"★".repeat(Math.max(0, 5 - r.rating))}</span>
                  </span>
                </div>
                <p className="text-body mt-2 whitespace-pre-line break-words">{r.body}</p>
                {r.hidden && (
                  <p className="text-caption text-danger mt-2">Hidden by Vela moderators: it no longer shows on the vendor&apos;s page.</p>
                )}
                {r.vendorReply && (
                  <div className="mt-3 rounded-control bg-surface-muted px-3 py-2">
                    <p className="text-caption font-medium text-ink-soft">Reply from {r.vendorName}</p>
                    <p className="text-body mt-0.5 whitespace-pre-line break-words">{r.vendorReply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
