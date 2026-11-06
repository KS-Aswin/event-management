import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { findVendorLead, getOwnVendor } from "@/lib/db";
import { getVendorThread, markThreadRead, offerBuilderContext } from "@/lib/enquiry-thread";
import { canSendOffer } from "@/lib/enquiry-status";
import { OfferCard } from "@/app/_components/enquiry-thread/offer-card";
import { MessageList, StatusTimeline } from "@/app/_components/enquiry-thread/message-list";
import Composer from "@/app/_components/enquiry-thread/composer";
import OfferBuilder from "./offer-builder";
import ReviewRequestLink from "../../_components/review-request-link";
import LeadStatusControl from "../lead-status-control";
import LeadFollowupForm from "../lead-followup-form";
import { LeadContact, LeadMessage } from "../lead-contact";
import { StatusPill } from "../lead-row";
import {
  CONTACT_PREF_LABEL,
  FOOD_PREF_LABEL,
  SLOT_LABEL,
  VENUE_TYPE_LABEL,
  asStatus,
  formatBudgetRange,
  formatDate,
  formatEventDate,
  formatQty,
  formatReceived,
  isQuoted,
  leadWhatsappText,
  phoneDigits,
  telHref,
  unitPriceSnapshot,
  whatsappUrl,
} from "../format";

export const metadata: Metadata = { title: "Lead" };

// One lead (PRODUCT_PLAN P0-14, P2-4, P2-5): the event context, the units the
// customer asked for with quantity and the price at the time, contact
// actions, status, private notes and a follow-up date, plus the thread with
// the customer, itemised offers (builder + versions) and the status history. Only the vendor's own leads: any other
// id is a 404 here (the API answers 403).
export default async function VendorLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { session } = await requirePageRole("vendor");
  const vendor = await getOwnVendor(session.userId);
  if (!vendor) redirect("/vendor/onboarding");
  const { id } = await params;
  const leadId = parseId(id);
  if (leadId === null) notFound();
  // The thread first: it also expires the lead if its event date has passed.
  const thread = await getVendorThread(vendor.id, leadId);
  if (!thread) notFound();
  const [l, builder] = await Promise.all([findVendorLead(vendor.id, leadId), offerBuilderContext(vendor.id, leadId)]);
  if (!l || !builder) notFound();
  // Loaded first (so new messages still show as new), then marked read.
  await markThreadRead(leadId, "vendor", session.userId);
  const latestOffer = thread.offers[0] ?? null;
  // The offer to show on top: the open one, else the latest one if booking or
  // declining the lead closed it (QA-067), so the card explains what happened.
  const liveOffer =
    thread.offers.find((o) => o.status === "sent" || o.status === "accepted") ??
    (latestOffer?.status === "closed" ? latestOffer : null);
  const olderOffers = thread.offers.filter((o) => o !== liveOffer);
  const firstName = l.name.split(" ")[0] || l.name;
  const closed =
    l.status === "withdrawn"
      ? `${firstName} withdrew this enquiry, so the conversation is closed.`
      : l.status === "expired"
        ? "This enquiry expired when the event date passed."
        : null;

  const status = asStatus(l.status);
  const budget = formatBudgetRange(l.budget_min, l.budget_max, l.budget);
  const digits = phoneDigits(l.phone);
  const wa = whatsappUrl(
    l.phone,
    leadWhatsappText({
      customerName: l.name,
      vendorName: vendor.name,
      eventType: l.event_type_name,
      eventDate: l.event_date,
      units: l.units.map((u) => u.title),
    })
  );

  const eventRows: [string, string][] = [];
  if (l.event_type_name) eventRows.push(["Event", l.event_type_name]);
  eventRows.push([
    "Date",
    l.event_date
      ? `${formatEventDate(l.event_date)}${l.event_end_date && l.event_end_date !== l.event_date ? ` to ${formatDate(l.event_end_date)}` : ""}`
      : "Not decided yet",
  ]);
  if (l.slot) eventRows.push(["Time of day", SLOT_LABEL[l.slot] ?? l.slot]);
  if (l.guest_count) eventRows.push(["Guests", l.guest_count.toLocaleString("en-IN")]);
  if (l.district_name || l.venue_text) {
    eventRows.push(["Where", [l.venue_text, l.district_name].filter(Boolean).join(", ")]);
  }
  if (l.venue_type) eventRows.push(["Venue type", VENUE_TYPE_LABEL[l.venue_type] ?? l.venue_type]);
  if (l.food_pref) eventRows.push(["Food", FOOD_PREF_LABEL[l.food_pref] ?? l.food_pref]);
  if (budget) eventRows.push(["Budget", budget]);

  return (
    <main className="page py-6 sm:py-8">
      <Link href="/vendor/leads" className="btn btn-ghost btn-sm -ml-3.5 mb-2">
        <span aria-hidden="true">←</span> All leads
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">{l.name}</h1>
            <StatusPill status={l.status} audience="vendor" quoted={isQuoted(l.status, latestOffer?.status)} />
          </div>
          <p className="text-ink-soft text-body mt-1">
            Received {formatReceived(l.created_at)}
            {l.preferred_contact ? ` · prefers ${CONTACT_PREF_LABEL[l.preferred_contact] ?? l.preferred_contact}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-caption text-ink-soft hidden sm:inline">Status</span>
          <LeadStatusControl leadId={l.id} status={l.status} leadName={l.name} hasEventDate={!!l.event_date} quoted={isQuoted(l.status, latestOffer?.status)} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card" aria-labelledby="contact-h">
            <h2 id="contact-h" className="text-title font-semibold">
              Contact {l.name.split(" ")[0]}
            </h2>
            {digits ? (
              <LeadContact
                leadId={l.id}
                phone={l.phone}
                telHref={telHref(l.phone)}
                waHref={wa}
                email={l.contact_email}
                isPending={status === "pending"}
                size="md"
              />
            ) : (
              <p className="text-body mt-2">{l.phone}</p>
            )}
            {wa && (
              <p className="hint">WhatsApp opens with a short greeting you can edit before sending.</p>
            )}
          </section>

          <section className="card" aria-labelledby="event-h">
            <h2 id="event-h" className="text-title font-semibold mb-2">
              Event details
            </h2>
            <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-4 text-body">
              {eventRows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-soft py-2 border-b border-line">{k}</dt>
                  <dd className="py-2 border-b border-line min-w-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {l.message ? (
              <div className="mt-4">
                <h3 className="eyebrow">Message</h3>
                <LeadMessage message={l.message} clamp={false} />
              </div>
            ) : null}
          </section>

          <section className="card" aria-labelledby="units-h">
            <h2 id="units-h" className="text-title font-semibold">
              Asked for
            </h2>
            {l.units.length === 0 ? (
              <p className="text-body text-ink-soft mt-1">
                The customer didn&apos;t pick a specific offering. Ask what they need when you reply.
              </p>
            ) : (
              <ul className="mt-2">
                {l.units.map((u) => {
                  const qty = formatQty(u.qty);
                  const price = unitPriceSnapshot(u);
                  return (
                    <li key={u.service_id} className="flex items-start justify-between gap-3 py-3 border-b border-line last:border-b-0">
                      <div className="min-w-0">
                        <p className="font-medium text-body">
                          {u.title}
                          {u.kind === "package" && <span className="chip ml-2 align-middle">Package</span>}
                          {u.kind === "addon" && <span className="chip ml-2 align-middle">Add-on</span>}
                        </p>
                        {price && <p className="text-caption text-ink-soft mt-0.5">{price} when asked</p>}
                        {u.note && <p className="text-caption mt-1">&ldquo;{u.note}&rdquo;</p>}
                      </div>
                      {qty && (
                        <span className="text-body font-medium tabular-nums whitespace-nowrap">
                          <span className="sr-only">Quantity </span>×{qty}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="offer-h">
            <h2 id="offer-h" className="text-title font-semibold mb-3">
              Offer
            </h2>
            {liveOffer ? (
              <OfferCard
                offer={liveOffer}
                title={`Your offer v${liveOffer.version}`}
                actions={
                  liveOffer.status === "closed" ? (
                    <p className="text-body text-ink-soft">
                      {l.status === "booked"
                        ? `Closed when you marked this lead Booked, so ${firstName} can no longer accept or decline it. Agree the final amount with them directly.`
                        : l.status === "declined"
                          ? `Closed when you declined this lead. ${firstName} can no longer accept it.`
                          : "This offer is closed."}
                    </p>
                  ) : null
                }
              />
            ) : (
              <p className="text-body text-ink-soft mb-3">
                {thread.offers.length
                  ? "No open offer right now."
                  : `Send ${firstName} an itemised offer: prices per item, travel, validity and advance. Customers compare offers side by side.`}
              </p>
            )}
            {liveOffer?.status === "accepted" && status !== "booked" && (
              <p className="alert-success mt-3">{firstName} accepted this offer. Mark the lead Booked once the advance is settled.</p>
            )}
            {canSendOffer(l.status) && (
              <div className="mt-4">
                <OfferBuilder
                  leadId={l.id}
                  units={l.units
                    .filter((u) => u.kind !== "package" || u.price_from)
                    .map((u) => ({
                      serviceId: u.service_id,
                      title: u.title,
                      qty: u.qty === null ? null : Number(u.qty),
                      priceFrom: u.price_mode === "on_request" ? null : u.price_from,
                      priceUnit: u.price_unit,
                      unitLabel: u.unit_label,
                    }))}
                  guestCount={l.guest_count}
                  hasGstin={builder.hasGstin}
                  travelFee={builder.travelFee}
                  previous={latestOffer}
                  version={(latestOffer?.version ?? 0) + 1}
                />
              </div>
            )}
            {olderOffers.length > 0 && (
              <div className="mt-4">
                <h3 className="eyebrow mb-2">Earlier offers</h3>
                <div className="flex flex-col gap-3">
                  {olderOffers.map((o) => (
                    <OfferCard key={o.id} offer={o} compact />
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="thread-h">
            <h2 id="thread-h" className="text-title font-semibold mb-3">
              Conversation
            </h2>
            <MessageList
              messages={thread.messages}
              viewer="vendor"
              otherName={firstName}
              emptyText={`No messages yet. Reply here and ${firstName} sees it in their enquiries (and gets notified).`}
            />
            <div className="mt-4 border-t border-line pt-4">
              <Composer
                endpoint={`/api/vendor/leads/${l.id}/messages`}
                label={`Reply to ${firstName}`}
                placeholder="e.g. Thanks! The date is free. Shall I send an offer for 300 plates?"
                closedReason={closed}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4 min-w-0">
          <section className="card" aria-labelledby="notes-h">
            <h2 id="notes-h" className="text-title font-semibold mb-2">
              Notes and follow-up
            </h2>
            <LeadFollowupForm leadId={l.id} initialNotes={l.vendor_notes} initialFollowUp={l.follow_up_at} />
          </section>
          {status === "booked" && l.event_date && (
            <p className="alert-success">
              Booked. {formatDate(l.event_date)} is marked as booked on your{" "}
              <Link href={`/vendor/calendar?month=${l.event_date.slice(0, 7)}`} className="underline underline-offset-2">
                calendar
              </Link>
              .
            </p>
          )}
          {status !== "booked" && l.event_date && (
            <p className="hint -mt-1">Marking this lead Booked also marks {formatDate(l.event_date)} as booked on your calendar.</p>
          )}
          {(status === "booked" || status === "accepted") && (
            <section className="card" aria-labelledby="review-req-h">
              <h2 id="review-req-h" className="text-title font-semibold">
                Request a review
              </h2>
              <p className="text-body text-ink-soft mt-1 mb-3">
                After the event, send {firstName} your review link. Reviews from booked customers show a &ldquo;Verified booking&rdquo; tag.
              </p>
              <ReviewRequestLink vendorId={vendor.id} vendorName={vendor.name} customerName={l.name} customerPhone={l.phone} />
            </section>
          )}
          <section className="card" aria-labelledby="timeline-h">
            <h2 id="timeline-h" className="text-title font-semibold mb-3">
              Status history
            </h2>
            <StatusTimeline createdAt={new Date(l.created_at).toISOString()} events={thread.events} viewer="vendor" />
          </section>
        </aside>
      </div>
    </main>
  );
}
