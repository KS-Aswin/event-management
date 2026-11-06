import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findVendorByOwner } from "@/lib/db";
import { listVendorReviews } from "@/lib/vendor-reviews";
import ReviewItem from "./review-item";
import ReviewRequestLink from "../_components/review-request-link";

export const metadata: Metadata = {
  title: "Reviews",
};

// Reviews on the vendor's listing with one public reply each (editable for
// 7 days) and a "request a review" link (PRODUCT_PLAN P2-11, P2-14).
// Reviews hidden by an admin are listed (badged) but can't be replied to.
export default async function VendorReviewsPage() {
  const { session } = await requirePageRole("vendor");
  const vendor = await findVendorByOwner(session.userId);
  const reviews = vendor ? await listVendorReviews(vendor.id) : [];
  const visible = reviews.filter((r) => !r.hidden);
  const average = visible.length > 0 ? visible.reduce((s, r) => s + r.rating, 0) / visible.length : 0;
  const awaiting = visible.filter((r) => !r.reply).length;

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-6">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Reviews</h1>
        <p className="text-ink-soft text-lead mt-1">What customers say about {vendor?.name ?? "your business"}.</p>
      </header>

      {!vendor ? (
        <div className="card max-w-xl">
          <h2 className="text-title font-semibold">No listing yet</h2>
          <p className="text-body text-ink-soft mt-1">
            Finish your listing so customers can find you, enquire and leave reviews.
          </p>
          <Link href="/vendor/onboarding" className="btn btn-primary mt-4">
            Continue setup
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="min-w-0">
            {reviews.length === 0 ? (
              <div className="card">
                <h2 className="text-title font-semibold">No reviews yet</h2>
                <p className="text-body text-ink-soft mt-1">
                  Reviews appear here once customers rate you. Send your review link to customers you have worked with.
                </p>
                <Link href={`/vendors/${vendor.id}?preview=1#reviews`} className="btn btn-secondary mt-4">
                  Open my public profile
                </Link>
              </div>
            ) : (
              <>
                <p className="text-body text-foreground mb-4">
                  {visible.length > 0 && (
                    <>
                      <span className="font-semibold">{average.toFixed(1)}</span> average from {visible.length} review
                      {visible.length === 1 ? "" : "s"}
                    </>
                  )}
                  {awaiting > 0 && (
                    <span className="text-ink-soft">
                      {visible.length > 0 ? " · " : ""}
                      {awaiting} waiting for your reply
                    </span>
                  )}
                </p>
                <ul className="flex flex-col gap-3">
                  {reviews.map((r) => (
                    <ReviewItem key={r.id} r={r} />
                  ))}
                </ul>
              </>
            )}
          </div>

          <aside className="card" aria-labelledby="request-h">
            <h2 id="request-h" className="text-title font-semibold">
              Request a review
            </h2>
            <p className="text-body text-ink-soft mt-1 mb-3">
              Reviews from booked customers get a &ldquo;Verified booking&rdquo; tag once the event date has passed.
            </p>
            <ReviewRequestLink vendorId={vendor.id} vendorName={vendor.name} />
          </aside>
        </div>
      )}
    </main>
  );
}
