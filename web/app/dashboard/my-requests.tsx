import Link from "next/link";
import type { FavoriteVendor, QuoteRequestWithVendor } from "@/lib/db";
import { StatusPill } from "@/app/vendor/leads/lead-row";
import { asStatus, formatDate, formatEventDate } from "@/app/vendor/leads/format";

// Quote requests and favourites the signed-in user made (customers, and
// vendors hiring other vendors).
export function MyRequestsAndFavorites({
  quotes,
  favorites,
  headingLevel = "h2",
}: {
  quotes: QuoteRequestWithVendor[];
  favorites: FavoriteVendor[];
  headingLevel?: "h2" | "h3";
}) {
  const H = headingLevel;
  return (
    <>
      <H className="text-base font-semibold mb-3">Your quote requests</H>
      {quotes.length === 0 ? (
        <div className="card sm:px-6 mb-8 text-sm text-ink-soft">
          You haven&apos;t sent any quote requests yet.{" "}
          <Link href="/search" className="text-accent hover:underline">
            Browse vendors
          </Link>{" "}
          to get started.
        </div>
      ) : (
        <div className="card py-2 sm:px-6 mb-8">
          {quotes.map((q, i) => (
            <div
              key={q.id}
              className={`py-2.5 text-sm ${i < quotes.length - 1 ? "border-b border-line" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link href={`/vendors/${q.vendor_id}`} className="inline-flex items-center min-h-11 font-medium hover:underline">
                  {q.vendor_name}
                </Link>
                <span className="text-ink-soft">({q.vendor_category})</span>
                <StatusPill status={q.status} audience="customer" />
              </div>
              <div className="text-ink-soft text-xs mt-0.5">
                Requested {formatDate(q.created_at)}
                {q.event_date ? ` · event on ${formatEventDate(q.event_date)}` : ""}
              </div>
              {asStatus(q.status) === "declined" && (
                <Link
                  href={`/search?category=${encodeURIComponent(q.vendor_category)}`}
                  className="inline-flex items-center min-h-10 text-xs text-accent hover:underline"
                >
                  Find similar vendors
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      <H className="text-base font-semibold mb-3">Your favorites</H>
      {favorites.length === 0 ? (
        <p className="card sm:px-6 text-sm text-ink-soft mb-8">
          No saved vendors yet. Tap the heart icon on a vendor to save them here for later.
        </p>
      ) : (
        <div className="card py-2 sm:px-6 mb-8">
          {favorites.map((f, i) => (
            <div
              key={f.id}
              className={`flex items-center justify-between gap-2.5 py-2.5 text-sm ${
                i < favorites.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <div className="min-w-0">
                <Link href={`/vendors/${f.id}`} className="inline-flex items-center min-h-11 font-medium hover:underline">
                  {f.name}
                </Link>{" "}
                <span className="text-ink-soft">
                  ({f.category} · {f.location})
                </span>
              </div>
              <span className="text-[13px] text-ink-soft whitespace-nowrap tabular-nums">{f.price_label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
