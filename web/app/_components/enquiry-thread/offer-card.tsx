import type { ReactNode } from "react";
import type { Offer } from "@/lib/enquiry-thread";
import { formatPaise } from "@/lib/offer-math";
import { formatDate, formatQty } from "@/app/vendor/leads/format";

// One itemised offer version (PRODUCT_PLAN P2-4), shared by the customer's
// enquiry page and the vendor's lead page. Server component: no hooks, so
// dates render once on the server. Actions (accept / decline) come in as a
// slot from the page.

const STATUS: Record<Offer["status"], { label: string; cls: string }> = {
  sent: { label: "Waiting for reply", cls: "bg-blue-50 text-blue-800 border-blue-200" },
  accepted: { label: "Accepted", cls: "bg-accent-tint text-accent-hover border-accent/30" },
  declined: { label: "Declined", cls: "bg-surface-muted text-[#3c4043] border-line-strong" },
  superseded: { label: "Replaced by a newer offer", cls: "bg-surface-muted text-ink-soft border-line" },
  expired: { label: "Expired", cls: "bg-surface-muted text-ink-soft border-line" },
  closed: { label: "Closed", cls: "bg-surface-muted text-ink-soft border-line" },
};

export function OfferStatusPill({ status }: { status: Offer["status"] }) {
  const s = STATUS[status];
  return <span className={`inline-block text-[11.5px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

function Row({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${strong ? "text-[15px] font-semibold border-t border-line mt-1 pt-2" : "text-body"}`}>
      <dt className={muted ? "text-ink-soft" : undefined}>{label}</dt>
      <dd className="tabular-nums whitespace-nowrap">{value}</dd>
    </div>
  );
}

export function OfferCard({
  offer,
  title,
  actions,
  compact = false,
}: {
  offer: Offer;
  /** Heading text, e.g. "Offer from Lens & Light". Defaults to "Offer vN". */
  title?: string;
  actions?: ReactNode;
  /** Older versions: lines collapsed behind a summary. */
  compact?: boolean;
}) {
  const advance = offer.advancePct ? Math.round((offer.totalPaise * offer.advancePct) / 100) : 0;
  const headingId = `offer-${offer.id}-h`;
  const body = (
    <>
      <table className="w-full text-body mt-3">
        <caption className="sr-only">Offer v{offer.version} line items</caption>
        <thead>
          <tr className="text-caption text-ink-soft text-left">
            <th scope="col" className="font-medium pb-1">
              Item
            </th>
            <th scope="col" className="font-medium pb-1 text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {offer.lines.map((l) => (
            <tr key={l.id} className="border-t border-line align-top">
              <td className="py-2 pr-3">
                <div className="font-medium break-words">{l.label}</div>
                <div className="text-caption text-ink-soft tabular-nums">
                  {formatQty(l.qty)} {l.unit} × {formatPaise(l.unitPricePaise)}
                </div>
              </td>
              <td className="py-2 text-right tabular-nums whitespace-nowrap">{formatPaise(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-2 border-t border-line pt-1">
        <Row label="Subtotal" value={formatPaise(offer.subtotalPaise)} muted />
        {offer.travelPaise > 0 && <Row label="Travel" value={formatPaise(offer.travelPaise)} muted />}
        {offer.gstPaise > 0 && <Row label="GST" value={formatPaise(offer.gstPaise)} muted />}
        {offer.discountPaise > 0 && <Row label="Discount" value={`− ${formatPaise(offer.discountPaise)}`} muted />}
        <Row label="Total" value={formatPaise(offer.totalPaise)} strong />
      </dl>
      <ul className="mt-3 flex flex-col gap-1 text-caption text-ink-soft">
        {offer.validUntil && (
          <li>
            {offer.status === "expired" ? "Expired on" : "Valid until"} {formatDate(offer.validUntil)}
          </li>
        )}
        {offer.advancePct ? (
          <li>
            Advance {offer.advancePct}% ({formatPaise(advance)}) to confirm
          </li>
        ) : null}
        <li>An estimate from the vendor. Payments are settled directly with them, not through Vela.</li>
      </ul>
      {offer.terms && (
        <div className="mt-3">
          <h4 className="eyebrow">Terms</h4>
          <p className="text-body whitespace-pre-line break-words mt-1">{offer.terms}</p>
        </div>
      )}
      {actions && <div className="mt-4">{actions}</div>}
    </>
  );

  return (
    <article
      aria-labelledby={headingId}
      data-testid={`offer-v${offer.version}`}
      className={`rounded-card border p-4 ${offer.status === "sent" || offer.status === "accepted" ? "border-accent/40 bg-white" : "border-line bg-surface-muted/60"}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-[15px] font-semibold">
          {title ?? `Offer v${offer.version}`}
          <span className="sr-only">, version {offer.version}</span>
        </h3>
        <OfferStatusPill status={offer.status} />
      </header>
      <p className="text-caption text-ink-soft mt-0.5">
        Sent {formatDate(offer.createdAt)} · total <span className="font-medium text-foreground tabular-nums">{formatPaise(offer.totalPaise)}</span>
      </p>
      {compact ? (
        <details className="mt-1 group">
          <summary className="inline-flex items-center min-h-11 cursor-pointer text-[13px] font-medium text-accent list-none [&::-webkit-details-marker]:hidden">
            Show items <span aria-hidden="true" className="ml-1 transition-transform group-open:rotate-180">▾</span>
          </summary>
          {body}
        </details>
      ) : (
        body
      )}
    </article>
  );
}
