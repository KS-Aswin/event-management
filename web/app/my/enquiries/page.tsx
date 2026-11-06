import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/app/api/_lib/auth";
import { listCustomerEnquiries, type CustomerEnquirySummary } from "@/lib/enquiry-thread";
import { formatPaise } from "@/lib/offer-math";
import { getCategoryLabeller } from "@/lib/taxonomy";
import { StatusPill } from "@/app/vendor/leads/lead-row";
import { formatEventDate, formatReceived } from "@/app/vendor/leads/format";

export const metadata: Metadata = { title: "My enquiries" };

// All enquiries the signed-in user sent, grouped by event date (PRODUCT_PLAN
// 2.3, P2-4/P2-5): status, vendor, units asked for, latest offer and unread
// replies. Vendors see the enquiries they sent as a customer (9 #21).

function groupKey(e: CustomerEnquirySummary) {
  return e.eventDate ?? "none";
}

function offerLine(e: CustomerEnquirySummary): string | null {
  const o = e.latestOffer;
  if (!o) return null;
  const what = `Offer v${o.version} · ${formatPaise(o.totalPaise)}`;
  switch (o.status) {
    case "sent":
      return e.status === "withdrawn" || e.status === "expired" ? what : `${what} · waiting for your reply`;
    case "accepted":
      return `${what} · accepted`;
    case "declined":
      return `${what} · you declined`;
    case "expired":
      return `${what} · expired`;
    default:
      return what;
  }
}

export default async function MyEnquiriesPage() {
  const { session } = await requirePageRole(["customer", "vendor"]);
  const [enquiries, categoryLabel] = await Promise.all([listCustomerEnquiries(session.userId), getCategoryLabeller()]);

  const groups: { key: string; items: CustomerEnquirySummary[] }[] = [];
  for (const e of enquiries) {
    const k = groupKey(e);
    const g = groups.find((x) => x.key === k);
    if (g) g.items.push(e);
    else groups.push({ key: k, items: [e] });
  }
  const unreadTotal = enquiries.reduce((s, e) => s + e.unread, 0);
  const awaiting = enquiries.filter((e) => e.latestOffer?.status === "sent" && e.status === "responded").length;

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-5">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">My enquiries</h1>
        <p className="text-ink-soft text-lead mt-1">
          {enquiries.length === 0
            ? "Quotes you ask vendors for show up here, with their replies and offers."
            : [
                `${enquiries.length} enquir${enquiries.length === 1 ? "y" : "ies"}`,
                unreadTotal ? `${unreadTotal} unread repl${unreadTotal === 1 ? "y" : "ies"}` : null,
                awaiting ? `${awaiting} offer${awaiting === 1 ? "" : "s"} waiting for you` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      </header>

      {enquiries.length === 0 ? (
        <section className="card py-10 text-center max-w-[52ch] mx-auto">
          <h2 className="text-title font-semibold">No enquiries yet</h2>
          <p className="text-body text-ink-soft mt-1">
            Find a vendor you like and tap &ldquo;Get quote&rdquo;. Their reply, offers and your conversation will all be here.
          </p>
          <Link href="/search" className="btn btn-primary mt-4">
            Find vendors
          </Link>
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`}>
              <h2 id={`g-${g.key}`} className="eyebrow mb-2">
                {g.key === "none" ? "No event date yet" : formatEventDate(g.key)}
                {g.items[0].eventTypeName ? ` · ${g.items[0].eventTypeName}` : ""}
              </h2>
              <ul className="card p-0 divide-y divide-line">
                {g.items.map((e) => (
                  <EnquiryItem key={e.id} e={e} category={categoryLabel(e.vendor.category)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function EnquiryItem({ e, category }: { e: CustomerEnquirySummary; category: string }) {
  const offer = offerLine(e);
  const needsYou = e.latestOffer?.status === "sent" && e.status === "responded";
  return (
    <li className="relative px-4 py-4 sm:px-5 hover:bg-surface-muted/60 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">
            {/* Stretched link: the whole row opens the thread. */}
            <Link
              href={`/my/enquiries/${e.id}`}
              className="after:absolute after:inset-0 after:content-[''] hover:underline underline-offset-2 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent focus-visible:after:rounded-card"
            >
              {e.vendor.name}
            </Link>
          </h3>
          <p className="text-caption text-ink-soft mt-0.5">
            {category}
            {e.districtName ? ` · ${e.districtName}` : ""}
            {e.guestCount ? ` · ${e.guestCount.toLocaleString("en-IN")} guests` : ""} · updated {formatReceived(e.lastActivityAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusPill status={e.status} audience="customer" />
          {e.unread > 0 && (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent">
              <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
              {e.unread} new
            </span>
          )}
        </div>
      </div>
      {e.units.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mt-2" aria-label="Asked for">
          {e.units.slice(0, 6).map((u) => (
            <li key={u} className="chip bg-accent-tint text-accent-hover">
              {u}
            </li>
          ))}
          {e.units.length > 6 && <li className="chip">+{e.units.length - 6} more</li>}
        </ul>
      )}
      {offer && <p className={`text-body mt-2 ${needsYou ? "font-medium text-accent-hover" : "text-ink-soft"}`}>{offer}</p>}
      {!e.vendor.available && e.status !== "withdrawn" && e.status !== "expired" && (
        <p className="text-caption text-danger mt-1">This vendor is currently unavailable on Vela.</p>
      )}
    </li>
  );
}
