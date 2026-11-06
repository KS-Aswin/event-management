import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/app/api/_lib/auth";
import { categoryLabeller, getTaxonomy } from "@/lib/taxonomy";
import type { Taxonomy, VendorRecord } from "@/lib/db";
import { listCustomerEnquiries, type CustomerEnquirySummary } from "@/lib/enquiry-thread";
import { findNextEvent, recommendedVendors, type NextEvent } from "@/lib/customer-home";
import { listShortlist } from "@/lib/shortlist";
import { formatPaise } from "@/lib/offer-math";
import { findCardMedia } from "@/app/search/card-media";
import VendorMiniCard from "@/app/_browse/vendor-mini-card";
import HomeSearch from "@/app/home-search";
import { formatDate, formatEventDate, formatReceived } from "@/app/vendor/leads/format";

export const metadata: Metadata = { title: "My events" };

// Customer home (PRODUCT_PLAN P2-1, 2.3). Discovery first (search and
// occasions), then the customer's own plan: the next event with what's still
// needed, replies and offers that need an answer, and the shortlist. No
// vendor calls to action here.

async function loadTaxonomy(): Promise<Taxonomy | null> {
  try {
    return await getTaxonomy();
  } catch {
    return null;
  }
}

/** Enquiries with something for the customer to read or answer. */
function needsYou(enquiries: CustomerEnquirySummary[]) {
  return enquiries
    .filter((e) => e.unread > 0 || (e.latestOffer?.status === "sent" && e.status === "responded"))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, 5);
}

function daysLabel(n: number) {
  if (n <= 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n < 60) return `In ${n} days`;
  const months = Math.round(n / 30);
  return `In about ${months} months`;
}

function searchHref(params: Record<string, string | number | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  return `/search?${sp.toString()}`;
}

export default async function MyHomePage() {
  const { session } = await requirePageRole("customer");
  const userId = session.userId;
  const [taxonomy, enquiries, shortlist, next] = await Promise.all([
    loadTaxonomy(),
    listCustomerEnquiries(userId),
    listShortlist(userId),
    findNextEvent(userId),
  ]);
  const categoryLabel = categoryLabeller(taxonomy);
  const recommended = await recommendedVendors(userId, { districtId: next?.districtId ?? null, limit: 6 });

  const eventTypes = taxonomy?.eventTypes.filter((e) => e.slug !== "other") ?? [];
  const districts = taxonomy?.districts.map((d) => d.name) ?? [];
  const categories = new Map(taxonomy?.categories.map((c) => [c.id, c]) ?? []);
  const firstName = session.name.split(" ")[0] || session.name;
  const actionable = needsYou(enquiries);
  const shortlistPreview = shortlist.filter((s) => s.available).slice(0, 4);
  const isNew = enquiries.length === 0 && shortlist.length === 0;

  // "Still needed": the event type's bundle (core first) minus categories
  // that already have a live enquiry for this event.
  let stillNeeded: { id: number; name: string; label: string; core: boolean }[] = [];
  if (next?.eventTypeId) {
    const bundle = taxonomy?.eventTypes.find((e) => e.id === next.eventTypeId)?.categories ?? [];
    const covered = new Set(next.coveredCategoryIds);
    stillNeeded = bundle
      .filter((b) => !covered.has(b.category_id) && categories.get(b.category_id)?.active)
      .sort((a, b) => Number(b.is_core) - Number(a.is_core))
      .map((b) => {
        const c = categories.get(b.category_id)!;
        // name = the ?category= filter value; label = the admin display name (QA-035).
        return { id: b.category_id, name: c.name, label: c.display_name?.trim() || c.name, core: b.is_core };
      });
  }

  const media = await findCardMedia(
    [...recommended, ...shortlistPreview.map((s) => ({ id: s.vendorId, status: "approved", published: true, cover_media_id: s.coverMediaId, cover_image_url: s.coverImageUrl }))] as unknown as VendorRecord[]
  );

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-5 sm:mb-6">
        <p className="eyebrow">My events</p>
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight mt-1">
          {isNew ? `Welcome, ${firstName}` : `Hi, ${firstName}`}
        </h1>
        <p className="text-ink-soft text-lead mt-1 max-w-[60ch]">
          {isNew
            ? "Tell us what you're planning and find vendors across Kerala. Your enquiries, offers and shortlist will gather here."
            : "Everything for your event in one place: replies, offers and the vendors you're considering."}
        </p>
      </header>

      <section aria-label="Find vendors" className="mb-8 flex flex-col items-center rounded-card bg-[radial-gradient(ellipse_80%_70%_at_50%_0%,var(--color-accent-tint),transparent_75%)] px-0 sm:px-4 pt-2 pb-1">
        <HomeSearch districts={districts} />
      </section>

      {isNew ? (
        <EmptyStart eventTypes={eventTypes} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="flex flex-col gap-6 min-w-0">
            {next ? (
              <NextEventCard next={next} stillNeeded={stillNeeded} />
            ) : (
              <section aria-labelledby="plan-heading" className="card">
                <h2 id="plan-heading" className="text-title font-semibold">No upcoming event yet</h2>
                <p className="text-body text-ink-soft mt-1">
                  Send an enquiry with your event date and we&apos;ll keep track of what you still need.
                </p>
                <OccasionChips eventTypes={eventTypes} className="mt-4" />
              </section>
            )}

            <section aria-labelledby="needs-heading">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h2 id="needs-heading" className="text-title font-semibold">Waiting for you</h2>
                <Link href="/my/enquiries" className="text-sm font-medium text-accent hover:underline underline-offset-2 inline-flex items-center min-h-11">
                  All enquiries
                </Link>
              </div>
              {actionable.length === 0 ? (
                <p className="card text-body text-ink-soft">
                  {enquiries.length > 0
                    ? "You're all caught up. New replies and offers from vendors will show here."
                    : "When vendors reply or send an offer, it shows here."}
                </p>
              ) : (
                <ul className="card p-0 divide-y divide-line">
                  {actionable.map((e) => (
                    <ActionRow key={e.id} e={e} category={categoryLabel(e.vendor.category)} />
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside aria-labelledby="shortlist-heading" className="card min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="shortlist-heading" className="text-title font-semibold">Your shortlist</h2>
              {shortlist.length > 0 && (
                <Link href="/my/shortlist" className="text-sm font-medium text-accent hover:underline underline-offset-2 inline-flex items-center min-h-11">
                  See all {shortlist.length}
                </Link>
              )}
            </div>
            {shortlistPreview.length === 0 ? (
              <p className="text-body text-ink-soft mt-1">
                Tap the heart on any vendor to save them here, add notes and compare them side by side.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {shortlistPreview.map((s) => (
                  <li key={s.vendorId}>
                    <VendorMiniCard
                      v={{
                        id: s.vendorId,
                        name: s.name,
                        location: s.location,
                        category: s.category,
                        rating: s.rating.toFixed(1),
                        reviews_count: s.reviewsCount,
                        verified: s.verified,
                        price: s.fromPrice,
                        price_label: s.priceLabel,
                        cover_media_id: s.coverMediaId,
                        cover_image_url: s.coverImageUrl,
                        status: "approved",
                        published: true,
                      }}
                      media={media.get(s.vendorId)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}

      {!isNew && next && eventTypes.length > 0 && (
        <section aria-labelledby="occasions-heading" className="mt-8">
          <h2 id="occasions-heading" className="eyebrow mb-3">Plan another occasion</h2>
          <OccasionChips eventTypes={eventTypes} />
        </section>
      )}

      {recommended.length > 0 && (
        <section aria-labelledby="rec-heading" className="mt-8">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h2 id="rec-heading" className="text-title font-semibold">
              {next?.districtName ? `Popular around ${next.districtName}` : "Popular on Vela"}
            </h2>
            <Link href="/search" className="text-sm font-medium text-accent hover:underline underline-offset-2 inline-flex items-center min-h-11">
              Browse all
            </Link>
          </div>
          <ul className="card grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {recommended.map((v) => (
              <li key={v.id} className="min-w-0">
                <VendorMiniCard v={v} media={media.get(v.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );

}

function NextEventCard({ next, stillNeeded }: { next: NextEvent; stillNeeded: { id: number; name: string; label: string; core: boolean }[] }) {
  const title = next.eventTypeName ?? "Your event";
  return (
    <section aria-labelledby="next-heading" className="card border-accent/30 bg-[linear-gradient(180deg,var(--color-accent-tint),var(--color-surface)_70%)]">
      <p className="eyebrow">Next event · {daysLabel(next.daysAway)}</p>
      <h2 id="next-heading" className="font-display text-heading font-semibold mt-1">
        {title}
      </h2>
      <p className="text-body text-ink-soft mt-0.5">
        {formatDate(next.date)}
        {next.districtName ? ` · ${next.districtName}` : ""}
        {next.guestCount ? ` · ${next.guestCount.toLocaleString("en-IN")} guests` : ""}
      </p>
      <dl className="flex gap-6 mt-4">
        <div>
          <dt className="text-caption text-ink-soft">Enquiries</dt>
          <dd className="text-title font-semibold tabular-nums">{next.enquiries}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-soft">Booked</dt>
          <dd className="text-title font-semibold tabular-nums">{next.booked}</dd>
        </div>
      </dl>

      {next.eventTypeId ? (
        <div className="mt-5 pt-4 border-t border-line">
          <h3 className="text-[15px] font-semibold">{stillNeeded.length ? "Still needed" : "Every usual service is covered"}</h3>
          {stillNeeded.length > 0 ? (
            <>
              <p className="text-caption text-ink-soft mt-0.5">
                Services most {title.toLowerCase()} plans include that you haven&apos;t asked about yet.
              </p>
              <ul className="flex flex-wrap gap-2 mt-3" aria-label="Still needed">
                {stillNeeded.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={searchHref({
                        category: c.name,
                        eventType: next.eventTypeSlug,
                        district: next.districtName,
                        date: next.date,
                      })}
                      className={`inline-flex items-center gap-1.5 min-h-11 rounded-full px-4 text-sm font-medium transition-colors whitespace-nowrap ${
                        c.core
                          ? "border border-accent/25 bg-white text-accent-hover hover:bg-accent hover:text-white"
                          : "border border-line bg-white text-foreground hover:bg-surface-muted"
                      }`}
                    >
                      <span aria-hidden="true">+</span>
                      {c.label}
                      {!c.core && <span className="sr-only"> (optional)</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-caption text-ink-soft mt-0.5">Add anything else you need from search.</p>
          )}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/my/enquiries" className="btn btn-secondary btn-sm">
          View enquiries
        </Link>
        {next.eventTypeSlug && (
          <Link href={`/e/${next.eventTypeSlug}`} className="btn btn-ghost btn-sm">
            {title} guide
          </Link>
        )}
      </div>
    </section>
  );
}

function ActionRow({ e, category }: { e: CustomerEnquirySummary; category: string }) {
  const offerWaiting = e.latestOffer?.status === "sent" && e.status === "responded";
  return (
    <li className="relative px-4 py-3.5 sm:px-5 hover:bg-surface-muted/60 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold truncate">
            <Link
              href={`/my/enquiries/${e.id}`}
              className="after:absolute after:inset-0 after:content-[''] hover:underline underline-offset-2 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent focus-visible:after:rounded-card"
            >
              {e.vendor.name}
            </Link>
          </h3>
          <p className="text-caption text-ink-soft mt-0.5">
            {category}
            {e.eventDate ? ` · ${formatEventDate(e.eventDate)}` : ""} · {formatReceived(e.lastActivityAt)}
          </p>
        </div>
        <span className="chip bg-accent-tint text-accent-hover shrink-0">
          {offerWaiting ? "Offer to review" : `${e.unread} new repl${e.unread === 1 ? "y" : "ies"}`}
        </span>
      </div>
      {offerWaiting && e.latestOffer && (
        <p className="text-body font-medium text-accent-hover mt-1.5">
          Offer v{e.latestOffer.version} · {formatPaise(e.latestOffer.totalPaise)}
        </p>
      )}
    </li>
  );
}

function OccasionChips({
  eventTypes,
  className = "",
}: {
  eventTypes: { slug: string; name: string }[];
  className?: string;
}) {
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {eventTypes.map((e) => (
        <li key={e.slug}>
          <Link
            href={`/e/${e.slug}`}
            className="inline-flex items-center min-h-11 border border-accent/25 bg-accent-tint text-accent-hover rounded-full px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-white whitespace-nowrap"
          >
            {e.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyStart({ eventTypes }: { eventTypes: { slug: string; name: string }[] }) {
  return (
    <section aria-labelledby="start-heading" className="card py-7 sm:py-8">
      <h2 id="start-heading" className="text-title font-semibold">What are you planning?</h2>
      <p className="text-body text-ink-soft mt-1 max-w-[56ch]">
        Pick an occasion to see the services it usually needs and the best vendors for each.
      </p>
      {eventTypes.length > 0 ? (
        <OccasionChips eventTypes={eventTypes} className="mt-4" />
      ) : (
        <Link href="/search" className="btn btn-primary mt-4">
          Find vendors
        </Link>
      )}
    </section>
  );
}
