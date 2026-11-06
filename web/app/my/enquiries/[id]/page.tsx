import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { getCustomerEnquiry, markThreadRead } from "@/lib/enquiry-thread";
import { canTransition } from "@/lib/enquiry-status";
import { formatPaise } from "@/lib/offer-math";
import { StatusPill } from "@/app/vendor/leads/lead-row";
import { OfferCard } from "@/app/_components/enquiry-thread/offer-card";
import { MessageList, StatusTimeline } from "@/app/_components/enquiry-thread/message-list";
import Composer from "@/app/_components/enquiry-thread/composer";
import { EnquiryActions, OfferActions } from "./enquiry-actions";
import {
  SLOT_LABEL,
  formatBudgetRange,
  formatDate,
  formatEventDate,
  formatQty,
  telHref,
  whatsappUrl,
} from "@/app/vendor/leads/format";

export const metadata: Metadata = { title: "Enquiry" };

// One enquiry, customer side (PRODUCT_PLAN 2.3, P2-4, P2-5): the vendor's
// offers with line items (accept / decline), the conversation, status
// timeline, withdraw and mark booked. Only the signed-in user's own enquiry;
// any other id is a 404.
export default async function MyEnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { session } = await requirePageRole(["customer", "vendor"]);
  const id = parseId((await params).id);
  if (id === null) notFound();
  const e = await getCustomerEnquiry({ userId: session.userId }, id);
  if (!e) notFound();
  // Load first (so new replies still show as new), then mark them read.
  await markThreadRead(e.id, "customer", session.userId);

  const { offers, messages, events } = e.thread;
  const live = offers.find((o) => o.status === "sent" || o.status === "accepted") ?? null;
  const older = offers.filter((o) => o !== live);
  const canAccept = canTransition(e.status, "accepted", "customer");
  const canWithdraw = canTransition(e.status, "withdrawn", "customer");
  const canBook = canTransition(e.status, "booked", "customer");
  const closed =
    e.status === "withdrawn"
      ? "You withdrew this enquiry, so the conversation is closed."
      : e.status === "expired"
        ? "This enquiry expired when the event date passed."
        : null;
  const budget = formatBudgetRange(e.budgetMin, e.budgetMax, e.budget);
  const wa = e.vendor.whatsapp ? whatsappUrl(e.vendor.whatsapp, `Hi ${e.vendor.name}, about my enquiry on Vela`) : null;

  const details: [string, string][] = [];
  if (e.eventTypeName) details.push(["Event", e.eventTypeName]);
  details.push([
    "Date",
    e.eventDate
      ? `${formatEventDate(e.eventDate)}${e.eventEndDate && e.eventEndDate !== e.eventDate ? ` to ${formatDate(e.eventEndDate)}` : ""}`
      : "Not decided yet",
  ]);
  if (e.slot) details.push(["Time of day", SLOT_LABEL[e.slot] ?? e.slot]);
  if (e.guestCount) details.push(["Guests", e.guestCount.toLocaleString("en-IN")]);
  if (e.districtName || e.venueText) details.push(["Where", [e.venueText, e.districtName].filter(Boolean).join(", ")]);
  if (budget) details.push(["Budget", budget]);

  return (
    <main className="page py-6 sm:py-8">
      <Link href="/my/enquiries" className="btn btn-ghost btn-sm -ml-3.5 mb-2">
        <span aria-hidden="true">←</span> All enquiries
      </Link>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">{e.vendor.name}</h1>
          <StatusPill status={e.status} audience="customer" />
        </div>
        <p className="text-ink-soft text-body mt-1">
          {e.vendor.category}
          {e.eventDate ? ` · ${formatEventDate(e.eventDate)}` : ""} · sent {formatDate(e.createdAt)}
        </p>
        {e.vendor.available ? (
          <Link href={`/vendors/${e.vendor.id}`} className="inline-flex items-center min-h-11 text-[13px] font-medium text-accent hover:underline underline-offset-2">
            View vendor profile <span aria-hidden="true" className="ml-1">→</span>
          </Link>
        ) : (
          <p className="text-caption text-danger mt-1">This vendor is currently unavailable on Vela.</p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card" aria-labelledby="offers-h">
            <h2 id="offers-h" className="text-title font-semibold mb-3">
              Offer
            </h2>
            {live ? (
              <OfferCard
                offer={live}
                title={`Offer v${live.version} from ${e.vendor.name}`}
                actions={
                  live.status === "sent" && canAccept ? (
                    <OfferActions
                      enquiryId={e.id}
                      offerId={live.id}
                      version={live.version}
                      vendorName={e.vendor.name}
                      total={formatPaise(live.totalPaise)}
                    />
                  ) : live.status === "accepted" && canBook ? (
                    <p className="alert-success">You accepted this offer. Once you&apos;ve confirmed with the vendor, mark the enquiry as booked.</p>
                  ) : null
                }
              />
            ) : (
              <p className="text-body text-ink-soft">
                {e.status === "pending"
                  ? `No offer yet. ${e.vendor.name} usually replies with an itemised offer or a message.`
                  : offers.length
                    ? "There's no open offer right now. Ask the vendor below if you'd like a revised one."
                    : "No offer was sent for this enquiry."}
              </p>
            )}
            {older.length > 0 && (
              <div className="mt-4">
                <h3 className="eyebrow mb-2">Earlier offers</h3>
                <div className="flex flex-col gap-3">
                  {older.map((o) => (
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
              messages={messages}
              viewer="customer"
              otherName={e.vendor.name}
              emptyText={`No messages yet. Ask ${e.vendor.name} anything about your event.`}
            />
            <div className="mt-4 border-t border-line pt-4">
              <Composer
                endpoint={`/api/my/enquiries/${e.id}/messages`}
                label={`Message ${e.vendor.name}`}
                placeholder="e.g. Can you share photos of a similar stage setup?"
                closedReason={closed}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4 min-w-0">
          {(canWithdraw || canBook) && (
            <section className="card" aria-label="Actions">
              <EnquiryActions enquiryId={e.id} canWithdraw={canWithdraw} canBook={canBook} vendorName={e.vendor.name} />
            </section>
          )}
          <section className="card" aria-labelledby="details-h">
            <h2 id="details-h" className="text-title font-semibold mb-2">
              Your event
            </h2>
            <dl className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-4 text-body">
              {details.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-soft py-2 border-b border-line">{k}</dt>
                  <dd className="py-2 border-b border-line min-w-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {e.units.length > 0 && (
              <div className="mt-3">
                <h3 className="eyebrow">Asked for</h3>
                <ul className="mt-1">
                  {e.units.map((u) => {
                    const q = formatQty(u.qty);
                    return (
                      <li key={u.serviceId} className="flex justify-between gap-3 py-1.5 text-body">
                        <span className="min-w-0 break-words">{u.title}</span>
                        {q && <span className="tabular-nums text-ink-soft">×{q}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {e.message && (
              <div className="mt-3">
                <h3 className="eyebrow">Your message</h3>
                <p className="text-body whitespace-pre-line break-words mt-1">{e.message}</p>
              </div>
            )}
          </section>
          {(e.vendor.phone || wa) && (
            <section className="card" aria-labelledby="contact-h">
              <h2 id="contact-h" className="text-title font-semibold mb-2">
                Contact {e.vendor.name}
              </h2>
              <div className="flex flex-wrap gap-2">
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                    WhatsApp
                  </a>
                )}
                {e.vendor.phone && (
                  <a href={telHref(e.vendor.phone)} className="btn btn-secondary">
                    Call
                  </a>
                )}
              </div>
            </section>
          )}
          <section className="card" aria-labelledby="timeline-h">
            <h2 id="timeline-h" className="text-title font-semibold mb-3">
              Status
            </h2>
            <StatusTimeline createdAt={e.createdAt} events={events} viewer="customer" />
          </section>
        </aside>
      </div>
    </main>
  );
}
