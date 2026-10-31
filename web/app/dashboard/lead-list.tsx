import Link from "next/link";
import type { FavoriteVendor, LeadRecord, QuoteRequestWithVendor } from "@/lib/db";
import LeadStatusControl from "./lead-status-control";
import { LeadContact, LeadMessage } from "./lead-contact";
import {
  CUSTOMER_STATUS_LABEL,
  LEAD_STATUS_LABEL,
  STATUS_PILL_CLASS,
  asStatus,
  formatBudget,
  formatDate,
  formatEventDate,
  phoneDigits,
  whatsappUrl,
  type QuoteStatusKey,
} from "./format";

export function StatusPill({ status, audience }: { status: string; audience: "vendor" | "customer" }) {
  const s: QuoteStatusKey = asStatus(status);
  const label = audience === "vendor" ? LEAD_STATUS_LABEL[s] : CUSTOMER_STATUS_LABEL[s];
  return (
    <span
      className={`inline-block text-[11.5px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_PILL_CLASS[s]}`}
    >
      {label}
    </span>
  );
}

// One enquiry, as the vendor sees it.
export function LeadRow({ lead: l, last }: { lead: LeadRecord; last: boolean }) {
  const digits = phoneDigits(l.phone);
  return (
    <div className={`py-4 text-sm ${last ? "pb-1" : "border-b border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 pt-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-[15px]">{l.name}</span>
            <StatusPill status={l.status} audience="vendor" />
          </div>
          <div className="text-ink-soft text-xs mt-1">Received {formatDate(l.created_at)}</div>
        </div>
        <LeadStatusControl quoteId={l.id} status={l.status} leadName={l.name} />
      </div>
      <div className="mt-2 max-w-[62ch]">
        <div className="text-[13.5px]">
          {l.event_date ? `Event on ${formatEventDate(l.event_date)}` : "No event date given"}
          {l.budget ? ` · budget ${formatBudget(l.budget)}` : ""}
        </div>
        {l.services && l.services.length > 0 ? (
          <div className="text-xs mt-0.5">Wants: {l.services.join(", ")}</div>
        ) : null}
        {l.message ? <LeadMessage message={l.message} /> : null}
        {digits ? (
          <LeadContact
            quoteId={l.id}
            phone={l.phone}
            telHref={`tel:${l.phone.trim().startsWith("+") ? "+" : ""}${digits}`}
            waHref={whatsappUrl(l.phone)}
            isPending={asStatus(l.status) === "pending"}
          />
        ) : (
          <div className="text-ink-soft text-xs mt-0.5">{l.phone}</div>
        )}
      </div>
    </div>
  );
}

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
