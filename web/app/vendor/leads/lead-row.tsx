import Link from "next/link";
import type { VendorLeadRecord } from "@/lib/db";
import type { VendorLeadExtras } from "@/lib/enquiry-thread";
import { formatPaise } from "@/lib/offer-math";
import LeadStatusControl from "./lead-status-control";
import { LeadContact, LeadMessage } from "./lead-contact";
import {
  CUSTOMER_STATUS_LABEL,
  LEAD_STATUS_LABEL,
  STATUS_PILL_CLASS,
  asStatus,
  daysFromToday,
  formatBudgetRange,
  formatEventDate,
  formatQty,
  formatReceived,
  formatShortDate,
  leadWhatsappText,
  phoneDigits,
  telHref,
  whatsappUrl,
  isQuoted,
  type QuoteStatusKey,
} from "./format";

export function StatusPill({
  status,
  audience,
  quoted = false,
}: {
  status: string;
  audience: "vendor" | "customer";
  /** Vendor side: an offer is out and waiting for the customer (see isQuoted). */
  quoted?: boolean;
}) {
  const s: QuoteStatusKey = asStatus(status);
  const showQuoted = audience === "vendor" && quoted && s === "responded";
  const label = showQuoted ? "Quoted" : audience === "vendor" ? LEAD_STATUS_LABEL[s] : CUSTOMER_STATUS_LABEL[s];
  return (
    <span
      data-status-pill={showQuoted ? "quoted" : s}
      className={`inline-block text-[11.5px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
        showQuoted ? STATUS_PILL_CLASS.accepted : STATUS_PILL_CLASS[s]
      }`}
    >
      {label}
    </span>
  );
}

/** "Wedding · Sat, 12 Dec 2026 · 300 guests · Thrissur" */
export function leadContextParts(l: VendorLeadRecord): string[] {
  const parts: string[] = [];
  if (l.event_type_name) parts.push(l.event_type_name);
  parts.push(l.event_date ? formatEventDate(l.event_date) : "No date given");
  if (l.guest_count) parts.push(`${l.guest_count.toLocaleString("en-IN")} guests`);
  if (l.district_name) parts.push(l.district_name);
  return parts;
}

/** Requested units as compact chips: "Stage decor ×2". */
export function UnitChips({ units }: { units: VendorLeadRecord["units"] }) {
  if (!units.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 mt-2" aria-label="Asked for">
      {units.map((u) => {
        const qty = formatQty(u.qty);
        return (
          <li key={u.service_id} className="chip bg-accent-tint text-accent-hover">
            {u.title}
            {qty && qty !== "1" ? <span className="tabular-nums"> ×{qty}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

// One enquiry in the inbox, as the vendor sees it.
const OFFER_STATE: Record<string, string> = {
  sent: "waiting for the customer",
  accepted: "accepted",
  declined: "declined",
  superseded: "replaced",
  expired: "expired",
};

export function LeadRow({
  lead: l,
  vendorName,
  extras,
}: {
  lead: VendorLeadRecord;
  vendorName: string;
  /** Unread customer messages and the latest offer (P2-4/P2-5). */
  extras?: VendorLeadExtras;
}) {
  const digits = phoneDigits(l.phone);
  const status = asStatus(l.status);
  const budget = formatBudgetRange(l.budget_min, l.budget_max, l.budget);
  const followDiff = l.follow_up_at ? daysFromToday(l.follow_up_at) : null;
  const followDue = followDiff !== null && followDiff <= 0 && (status === "pending" || status === "responded");
  const wa = whatsappUrl(
    l.phone,
    leadWhatsappText({
      customerName: l.name,
      vendorName,
      eventType: l.event_type_name,
      eventDate: l.event_date,
      units: l.units.map((u) => u.title),
    })
  );

  return (
    <article className="py-4 border-b border-line last:border-b-0 text-sm" aria-labelledby={`lead-${l.id}-name`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 pt-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={`lead-${l.id}-name`} className="font-semibold text-[15px]">
              <Link href={`/vendor/leads/${l.id}`} className="hover:underline underline-offset-2">
                {l.name}
              </Link>
            </h3>
            <StatusPill status={l.status} audience="vendor" quoted={isQuoted(l.status, extras?.offer?.status)} />
            {extras && extras.unread > 0 && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent">
                <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
                {extras.unread} new message{extras.unread === 1 ? "" : "s"}
              </span>
            )}
            {followDue && (
              <span className="inline-block text-[11.5px] font-medium px-2 py-0.5 rounded-full bg-danger-tint text-danger">
                Follow up {followDiff === 0 ? "today" : `since ${formatShortDate(l.follow_up_at!)}`}
              </span>
            )}
          </div>
          <div className="text-ink-soft text-xs mt-1">Received {formatReceived(l.created_at)}</div>
        </div>
        <LeadStatusControl leadId={l.id} status={l.status} leadName={l.name} hasEventDate={!!l.event_date} />
      </div>
      <div className="mt-2 max-w-[66ch]">
        <p className="text-[13.5px]">
          {leadContextParts(l).join(" · ")}
          {budget ? ` · budget ${budget}` : ""}
        </p>
        <UnitChips units={l.units} />
        {extras?.offer && (
          <p className="text-[13px] text-ink-soft mt-2">
            Offer v{extras.offer.version} · {formatPaise(extras.offer.totalPaise)} · {OFFER_STATE[extras.offer.status] ?? extras.offer.status}
          </p>
        )}
        {l.message ? <LeadMessage message={l.message} /> : null}
        {digits ? (
          <LeadContact
            leadId={l.id}
            phone={l.phone}
            telHref={telHref(l.phone)}
            waHref={wa}
            isPending={status === "pending"}
          />
        ) : (
          <div className="text-ink-soft text-xs mt-1">{l.phone}</div>
        )}
        <Link href={`/vendor/leads/${l.id}`} className="inline-flex items-center gap-1 min-h-11 sm:min-h-9 mt-1 text-[13px] font-medium text-accent hover:underline underline-offset-2">
          Conversation, offer and notes
          <span aria-hidden="true">→</span>
          <span className="sr-only"> for {l.name}</span>
        </Link>
      </div>
    </article>
  );
}
