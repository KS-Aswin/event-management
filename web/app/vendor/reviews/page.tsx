import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findReviewsByVendor, findVendorByOwner } from "@/lib/db";

export const metadata: Metadata = {
  title: "Reviews",
};

function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="text-gold tracking-tight" aria-label={`${r} out of 5 stars`}>
      <span aria-hidden="true">{"★".repeat(r)}</span>
      <span aria-hidden="true" className="text-line-strong">
        {"★".repeat(5 - r)}
      </span>
    </span>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Read-only list for P0; public replies and "request a review" come in P2.
export default async function VendorReviewsPage() {
  const { session } = await requirePageRole("vendor");
  const vendor = await findVendorByOwner(session.userId);
  const reviews = vendor ? await findReviewsByVendor(vendor.id, { limit: 100 }) : [];
  const average =
    reviews.length > 0 ? reviews.reduce((s, r) => s + Number(r.rating), 0) / reviews.length : 0;

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-6">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">
          Reviews
        </h1>
        <p className="text-ink-soft text-lead mt-1">
          What customers say about {vendor?.name ?? "your business"}.
        </p>
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
      ) : reviews.length === 0 ? (
        <div className="card max-w-xl">
          <h2 className="text-title font-semibold">No reviews yet</h2>
          <p className="text-body text-ink-soft mt-1">
            Reviews appear here once customers rate you. Customers you have worked with can review you
            from your public profile.
          </p>
          <Link href={`/vendors/${vendor.id}?preview=1#reviews`} className="btn btn-secondary mt-4">
            Open my public profile
          </Link>
        </div>
      ) : (
        <>
          <p className="text-body text-foreground mb-4">
            <span className="font-semibold">{average.toFixed(1)}</span> average from{" "}
            {reviews.length} review{reviews.length === 1 ? "" : "s"}
          </p>
          <ul className="flex flex-col gap-3 max-w-3xl">
            {reviews.map((r) => (
              <li key={r.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="font-medium text-foreground">
                    {r.reviewer_name}
                    {r.verified && <span className="chip ml-2 align-middle">Enquired via Vela</span>}
                  </p>
                  <time dateTime={new Date(r.created_at).toISOString()} className="text-caption text-ink-soft">
                    {dateFmt.format(new Date(r.created_at))}
                  </time>
                </div>
                <Stars rating={Number(r.rating)} />
                {r.body && <p className="text-body text-foreground mt-2 whitespace-pre-line">{r.body}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
