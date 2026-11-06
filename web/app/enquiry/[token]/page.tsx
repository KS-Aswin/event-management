import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findEnquiryByToken, isGuestToken, type TrackedOffer } from "@/lib/enquiry-tracking";
import {
  CONTACT_PREF_LABEL,
  FOOD_PREF_LABEL,
  SLOT_LABEL,
  VENUE_TYPE_LABEL,
  formatDate,
  formatEventDate,
  formatQty,
  formatReceived,
} from "@/app/vendor/leads/format";
import { PRICE_UNIT_LABELS, type PriceUnit } from "@/lib/offering-validation";

// /enquiry/[token]: public, read-only tracking page for an enquiry sent
// without an account (P2-3). The token is the key; nothing is indexed and
// the token never leaks through the Referer header.

export const metadata: Metadata = {
  title: "Your enquiry",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const STATUS: Record<string, { label: string; hint: string; pill: string }> = {
  pending: {
    label: "Waiting for the vendor",
    hint: "The vendor has your request and will contact you on your preferred channel.",
    pill: "bg-[#fbf3d9] text-gold-ink border-[#ecd98f]",
  },
  responded: {
    label: "Vendor replied",
    hint: "The vendor has replied. See their offer and messages below.",
    pill: "bg-blue-50 text-blue-800 border-blue-200",
  },
  accepted: {
    label: "Offer accepted",
    hint: "You accepted an offer. The vendor will confirm the booking with you.",
    pill: "bg-accent-tint text-accent-hover border-accent/30",
  },
  booked: {
    label: "Booked",
    hint: "This vendor is booked for your event.",
    pill: "bg-accent-tint text-accent-hover border-accent/30",
  },
  declined: {
    label: "Vendor declined",
    hint: "The vendor can't take this event. Try another vendor for the same date.",
    pill: "bg-surface-muted text-[#3c4043] border-line-strong",
  },
  withdrawn: {
    label: "Withdrawn",
    hint: "This enquiry was withdrawn.",
    pill: "bg-surface-muted text-[#3c4043] border-line-strong",
  },
  expired: {
    label: "Expired",
    hint: "This enquiry has expired.",
    pill: "bg-surface-muted text-[#3c4043] border-line-strong",
  },
};

const OFFER_STATUS: Record<string, string> = {
  sent: "Current offer",
  accepted: "Accepted",
  declined: "Declined",
  superseded: "Replaced by a newer version",
  expired: "Expired",
  closed: "Closed",
};

function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function unitText(unit: string | null, label: string | null): string {
  if (label) return label;
  if (!unit) return "";
  return (PRICE_UNIT_LABELS[unit as PriceUnit] ?? unit).replace(/^per /, "");
}

function OfferCard({ offer }: { offer: TrackedOffer }) {
  const current = offer.status === "sent" || offer.status === "accepted";
  const rows: [string, number][] = [["Subtotal", offer.subtotalPaise]];
  if (offer.travelPaise > 0) rows.push(["Travel", offer.travelPaise]);
  if (offer.discountPaise > 0) rows.push(["Discount", -offer.discountPaise]);
  if (offer.gstPaise > 0) rows.push(["GST", offer.gstPaise]);
  return (
    <article
      className={`card p-4 sm:p-5 ${current ? "border-accent/40" : "opacity-80"}`}
      aria-label={`Offer version ${offer.version}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-[15px]">Offer v{offer.version}</h3>
          <p className="text-caption text-ink-soft mt-0.5">Sent {formatReceived(offer.createdAt)}</p>
        </div>
        <span className={current ? "chip bg-accent-tint text-accent-hover" : "chip"}>
          {OFFER_STATUS[offer.status] ?? offer.status}
        </span>
      </div>
      {offer.lines.length ? (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {offer.lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block font-medium break-words">{l.label}</span>
                <span className="block text-caption text-ink-soft">
                  {formatQty(l.qty)} {l.unit} × {rupees(l.unitPricePaise)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{rupees(l.amountPaise)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="mt-3 space-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-ink-soft">
            <dt>{k}</dt>
            <dd className="tabular-nums">{v < 0 ? `− ${rupees(-v)}` : rupees(v)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 pt-1.5 font-semibold text-[15px]">
          <dt>Total</dt>
          <dd className="tabular-nums text-accent">{rupees(offer.totalPaise)}</dd>
        </div>
      </dl>
      {offer.validUntil || offer.advancePct != null ? (
        <p className="mt-3 text-caption text-ink-soft">
          {offer.validUntil ? `Valid until ${formatDate(offer.validUntil)}` : ""}
          {offer.validUntil && offer.advancePct != null ? " · " : ""}
          {offer.advancePct != null ? `${offer.advancePct}% advance to confirm` : ""}
        </p>
      ) : null}
      {offer.terms ? <p className="mt-2 text-sm text-ink-soft whitespace-pre-line break-words">{offer.terms}</p> : null}
    </article>
  );
}

export default async function EnquiryTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isGuestToken(token)) notFound();
  const e = await findEnquiryByToken(token);
  if (!e) notFound();

  const status = STATUS[e.status] ?? STATUS.pending;
  // "Replied" says what the vendor actually sent: a message, an offer or
  // both, so it never points at an offer that isn't there (QA-065).
  let hint = status.hint;
  if (e.status === "responded") {
    const hasOffer = e.offers.some((o) => o.status === "sent");
    const hasMessage = e.messages.some((m) => m.from === "vendor");
    hint = hasOffer
      ? hasMessage
        ? "The vendor has replied. See their offer and messages below."
        : "The vendor has sent you an offer. See it below."
      : hasMessage
        ? "The vendor has replied with a message. See it below. No priced offer yet."
        : "The vendor has seen your request and will contact you on your preferred channel.";
  }
  const details: [string, string][] = [];
  if (e.eventType) details.push(["Event", e.eventType]);
  if (e.eventDate) {
    details.push([
      "Date",
      e.eventEndDate && e.eventEndDate !== e.eventDate
        ? `${formatDate(e.eventDate)} – ${formatDate(e.eventEndDate)}`
        : formatEventDate(e.eventDate),
    ]);
  }
  if (e.slot) details.push(["Time", SLOT_LABEL[e.slot] ?? e.slot]);
  if (e.guestCount) details.push(["Guests", e.guestCount.toLocaleString("en-IN")]);
  if (e.district || e.venueType || e.venueText) {
    // "Where", as on the signed-in thread: a district alone isn't a venue (QA-065).
    details.push([
      "Where",
      [e.venueText, e.venueType ? VENUE_TYPE_LABEL[e.venueType] ?? e.venueType : null, e.district].filter(Boolean).join(", "),
    ]);
  }
  if (e.foodPref) details.push(["Food", FOOD_PREF_LABEL[e.foodPref] ?? e.foodPref]);
  if (e.budget) details.push(["Budget", e.budget]);
  details.push(["Reply by", CONTACT_PREF_LABEL[e.preferredContact] ?? e.preferredContact]);

  const next = encodeURIComponent("/my/enquiries");

  return (
    <main className="page-narrow py-6 sm:py-10 w-full">
      <p className="eyebrow">Enquiry tracking</p>
      <h1 className="font-display text-display sm:text-[30px] font-semibold leading-tight mt-1.5 break-words">
        Your enquiry to{" "}
        {e.vendor.available ? (
          <Link href={`/vendors/${e.vendor.id}`} className="text-accent hover:underline underline-offset-4">
            {e.vendor.name}
          </Link>
        ) : (
          e.vendor.name
        )}
      </h1>
      <p className="text-ink-soft text-sm mt-1.5">
        {/* The vendor's base town, not the event's location (QA-065). */}
        {e.vendor.category}
        {e.vendor.location ? ` · based in ${e.vendor.location}` : ""} · sent {formatReceived(e.createdAt)}
      </p>

      <section aria-labelledby="status-heading" className="card mt-5 sm:mt-6">
        <h2 id="status-heading" className="sr-only">
          Status
        </h2>
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${status.pill}`}>
          {status.label}
        </span>
        <p className="text-sm text-ink-soft mt-2.5 max-w-[60ch]">{hint}</p>
        {!e.vendor.available ? (
          <p role="note" className="alert-error mt-3">
            This vendor isn&apos;t available on Vela right now, so they may not reply. You can{" "}
            <Link href="/search" className="underline underline-offset-2">
              find another vendor
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section aria-labelledby="details-heading" className="card mt-4">
        <h2 id="details-heading" className="font-display text-title font-semibold">
          Event details
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {details.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-caption text-ink-soft">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {e.units.length ? (
          <div className="mt-4 pt-4 border-t border-line">
            <h3 className="text-sm font-semibold">What you asked for</h3>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {e.units.map((u, i) => (
                <li key={i} className="chip">
                  {u.title}
                  {u.qty != null ? ` · ${formatQty(u.qty)} ${unitText(u.priceUnit, u.unitLabel)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {e.message ? (
          <div className="mt-4 pt-4 border-t border-line">
            <h3 className="text-sm font-semibold">Your message</h3>
            <p className="mt-1.5 text-sm whitespace-pre-line break-words">{e.message}</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="offers-heading" className="mt-7">
        <h2 id="offers-heading" className="font-display text-title font-semibold">
          Offers
        </h2>
        {e.offers.length ? (
          <div className="mt-3 space-y-3">
            {e.offers.map((o) => (
              <OfferCard key={o.id} offer={o} />
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-card border border-dashed border-line-strong px-4 py-5 text-sm text-ink-soft">
            No offer yet. When {e.vendor.name} sends a priced offer, it appears here.
          </p>
        )}
      </section>

      <section aria-labelledby="messages-heading" className="mt-7">
        <h2 id="messages-heading" className="font-display text-title font-semibold">
          Messages
        </h2>
        {e.messages.length ? (
          <ol className="mt-3 space-y-2.5">
            {e.messages.map((m) => (
              <li
                key={m.id}
                className={`max-w-[85%] rounded-card px-3.5 py-2.5 text-sm ${
                  m.from === "you" ? "ml-auto bg-accent-tint" : "bg-surface-muted"
                }`}
              >
                <p className="text-caption font-semibold text-ink-soft">
                  {m.from === "you" ? "You" : m.from === "vendor" ? e.vendor.name : "Vela"} · {formatReceived(m.createdAt)}
                </p>
                <p className="mt-0.5 whitespace-pre-line break-words">{m.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 rounded-card border border-dashed border-line-strong px-4 py-5 text-sm text-ink-soft">
            No messages yet.
          </p>
        )}
      </section>

      <section aria-labelledby="account-heading" className="card mt-7 bg-surface-muted border-transparent">
        {e.linkedToAccount ? (
          <>
            <h2 id="account-heading" className="font-semibold">
              This enquiry is in your account
            </h2>
            <p className="text-sm text-ink-soft mt-1">Sign in to reply, accept offers and see all your enquiries.</p>
            <Link href={`/login?next=${next}`} className="btn btn-primary mt-3.5 w-full sm:w-auto">
              Sign in
            </Link>
          </>
        ) : (
          <>
            <h2 id="account-heading" className="font-semibold">
              Reply, accept offers and keep everything in one place
            </h2>
            <p className="text-sm text-ink-soft mt-1 max-w-[60ch]">
              Create a free account (any email) or sign in, and this enquiry is added to it.
            </p>
            <div className="mt-3.5 flex flex-col sm:flex-row gap-2.5">
              <Link href={`/signup?next=${next}&enquiry=${encodeURIComponent(token)}`} className="btn btn-primary">
                Create free account
              </Link>
              <Link href={`/login?next=${next}&enquiry=${encodeURIComponent(token)}`} className="btn btn-secondary">
                I have an account
              </Link>
            </div>
          </>
        )}
      </section>

      <p className="text-caption text-ink-soft mt-5">
        Keep this link private: anyone with it can see this enquiry.
      </p>
    </main>
  );
}
