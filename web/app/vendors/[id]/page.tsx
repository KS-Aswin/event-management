import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  findVendorById,
  findReviewsByVendor,
  isFavorited,
  findEventTypes,
  findDistricts,
  findUserById,
  type VendorRecord,
} from "@/lib/db";
import { formatE164, toE164, whatsappLink } from "@/lib/phone";
import { getSession, type SessionPayload } from "@/lib/session";
import { VendorTile } from "@/lib/vendorVisuals";
import FavoriteButton from "@/lib/favorite-button";
import QuoteButton from "./quote-button";
import ReviewForm from "./review-form";
import ReportReview from "./report-review";
import { reviewBreakdown, reviewEligibility } from "@/lib/vendor-reviews";
import { findLatestOpenEnquiry } from "@/lib/enquiries-create";
import { findEnquiryDefaults } from "@/lib/shortlist";
import EnquirySentLink from "./enquiry-sent-link";
import { reviewCountLabel, vendorFromPrice } from "@/lib/vendor-display";
import Gallery from "./gallery";
import OfferingsSection from "./offerings";
import VendorBeacon from "./vendor-beacon";
import { loadProfileMedia, loadProfileOfferings } from "./profile-data";
import { siteUrl } from "@/lib/site-url";
import { maskContactDetails } from "@/lib/offering-validation";
import { getCategoryLabeller } from "@/lib/taxonomy";

const MAX_INT4 = 2147483647;

/** Accepts only plain positive integers that fit a Postgres int4 ("1abc" and "1e3" are rejected). */
function parseId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= MAX_INT4 ? n : null;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** Public = approved by the Vela team and not unpublished by the vendor. */
function isPublic(vendor: VendorRecord) {
  const published = (vendor as VendorRecord & { published?: boolean }).published;
  return vendor.status === "approved" && published !== false;
}

function canView(vendor: VendorRecord, session: SessionPayload | null) {
  if (isPublic(vendor)) return true;
  if (!session) return false;
  return vendor.owner_id === session.userId || session.role === "admin";
}

function WhatsappIcon({ className = "w-[18px] h-[18px]" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}

const loadVendor = cache(async (rawId: string) => {
  const vendorId = parseId(rawId);
  if (vendorId === null) return null;
  const [vendor, categoryLabel] = await Promise.all([findVendorById(vendorId), getCategoryLabeller()]);
  if (!vendor) return null;
  // Free text the vendor typed is shown with phones, emails and links masked,
  // like offering text (QA-043): contact goes through Vela's sign-in gate.
  // categoryLabel is the admin display name (QA-035); vendor.category stays
  // the internal name for links and visuals.
  return {
    ...vendor,
    about: vendor.about ? maskContactDetails(vendor.about).text : vendor.about,
    tags: (vendor.tags ?? []).map((t) => maskContactDetails(t).text),
    categoryLabel: categoryLabel(vendor.category),
  };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const vendor = await loadVendor(id);
  if (!vendor || !isPublic(vendor)) {
    return { title: "Vendor", robots: { index: false, follow: false } };
  }
  const description =
    vendor.about?.slice(0, 160) || `${vendor.categoryLabel} in ${vendor.location}. ${vendorFromPrice(vendor) ?? "Price on request"}.`;
  return {
    title: `${vendor.name} — ${vendor.categoryLabel} in ${vendor.location}`,
    description,
    alternates: { canonical: `/vendors/${vendor.id}` },
    openGraph: {
      title: vendor.name,
      description,
      images: vendor.cover_image_url ? [vendor.cover_image_url] : undefined,
    },
  };
}

export default async function VendorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const vendor = await loadVendor(id);
  if (!vendor) notFound();
  const vendorId = vendor.id;

  const session = await getSession();
  if (!canView(vendor, session)) notFound();

  const isOwnListing = session ? vendor.owner_id === session.userId : false;
  // Owner (and admin) preview also sees media still under review, badged.
  const preview = isOwnListing || session?.role === "admin";
  const [reviews, breakdown, media, offerings, eventTypes, districts, viewer] = await Promise.all([
    findReviewsByVendor(vendorId),
    reviewBreakdown(vendorId),
    loadProfileMedia(vendor, preview),
    loadProfileOfferings(vendorId),
    findEventTypes(),
    findDistricts(),
    session ? findUserById(session.userId) : Promise.resolve(null),
  ]);

  const publicListing = isPublic(vendor);
  const myReview = session ? reviews.find((r) => r.customer_id === session.userId) : undefined;
  const favorited = session && !isOwnListing ? await isFavorited(session.userId, vendorId) : false;
  // Reviews v2 (P2-11, QA-038): only after an event the vendor replied to or was booked for.
  const customerId = session && session.role === "customer" && !isOwnListing ? session.userId : null;
  const reviewState = customerId !== null && !myReview ? (await reviewEligibility(vendorId, customerId)).state : "no_enquiry";
  const canReview = reviewState === "eligible";
  // QA-040/041: the customer's open enquiry here, and their saved event details for the sheet.
  const viewerPhoneE164 = (viewer as { phone_e164?: string | null } | null)?.phone_e164 ?? "";
  const [openEnquiry, enquiryDefaults] =
    customerId !== null
      ? await Promise.all([
          findLatestOpenEnquiry(customerId, vendorId),
          findEnquiryDefaults(customerId, { name: session?.name ?? "", phone: viewerPhoneE164 }),
        ])
      : [null, null];
  const quoteServices = offerings.quoteable;
  const hasMedia = media.photos.length > 0 || media.videos.length > 0;
  const languages = (vendor.languages ?? []).filter(Boolean);
  const loginHref = `/login?next=${encodeURIComponent(`/vendors/${vendorId}`)}`;
  const ratingNum = Number(vendor.rating);
  const hasRating = vendor.reviews_count > 0 && ratingNum > 0;
  // One price for this vendor everywhere (QA-023): the vendors.price_label cache.
  const fromPrice = vendorFromPrice(vendor);
  const priceText = fromPrice ?? "Price on request";
  // vendors.rating/reviews_count are recomputed from the visible reviews
  // (QA-010). Any older, imported ratings not listed here are called out
  // instead of silently inflating the count next to the breakdown.
  const importedCount = Math.max(0, vendor.reviews_count - breakdown.count);

  const viewerPhone = (viewer as { phone_e164?: string | null } | null)?.phone_e164 ?? "";
  const quoteProps = {
    vendorId: vendor.id,
    vendorName: vendor.name,
    services: quoteServices,
    defaultName: session?.name ?? "",
    defaultPhone: enquiryDefaults?.phone || viewerPhone,
    defaultEmail: viewer?.email ?? "",
    loggedIn: !!session,
    eventTypes: eventTypes.map((t) => ({ id: t.id, name: t.name })),
    districts: districts.map((d) => ({ id: d.id, name: d.name })),
    showFood: offerings.hasCatering || vendor.category === "Catering",
    prefill: enquiryDefaults,
    openEnquiry,
  };

  // P2-12 contact: WhatsApp click-to-chat (E.164 digits, URL-encoded text;
  // clicks are counted by VendorBeacon) and the phone for signed-in users.
  const waHref = whatsappLink(
    vendor.whatsapp || vendor.phone,
    `Hi ${vendor.name}, I found you on Vela (${siteUrl()}/vendors/${vendor.id}) and would like to know more about your services for my event.`
  );
  const phoneE164 = toE164(vendor.phone ?? "");
  const phoneText = phoneE164 ? formatE164(phoneE164) : vendor.phone?.trim() || null;
  const contactBlock =
    waHref || phoneText ? (
      <div className="space-y-2.5">
        {waHref ? (
          <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-block">
            <WhatsappIcon className="w-[18px] h-[18px] text-[#128c4b]" />
            Chat on WhatsApp
          </a>
        ) : null}
        {phoneText ? (
          session ? (
            <a
              href={`tel:${phoneE164 ?? phoneText.replace(/[^\d+]/g, "")}`}
              className="flex items-center justify-center gap-2 min-h-11 text-sm font-medium text-accent hover:underline underline-offset-2"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor">
                <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.6a1 1 0 0 1 1 .8l.7 3.1a1 1 0 0 1-.5 1.1l-1.4.8a11 11 0 0 0 5.3 5.3l.8-1.4a1 1 0 0 1 1.1-.5l3.1.7a1 1 0 0 1 .8 1v1.6a1.5 1.5 0 0 1-1.5 1.5h-1A13.5 13.5 0 0 1 2 4.5v-1Z" />
              </svg>
              Call {phoneText}
            </a>
          ) : (
            <p className="text-center text-sm text-ink-soft">
              <Link href={loginHref} className="inline-flex items-center min-h-11 font-medium text-accent hover:underline underline-offset-2">
                Sign in to see the phone number
              </Link>
            </p>
          )
        ) : null}
      </div>
    ) : null;

  const jsonLd = publicListing
    ? {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: vendor.name,
        description: vendor.about || undefined,
        image: media.coverUrl || media.logoUrl || undefined,
        priceRange: fromPrice || undefined,
        address: {
          "@type": "PostalAddress",
          addressLocality: vendor.location,
          addressRegion: "Kerala",
          addressCountry: "IN",
        },
        ...(vendor.reviews_count > 0 && ratingNum > 0
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: ratingNum,
                reviewCount: vendor.reviews_count,
              },
            }
          : {}),
      }
    : null;

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");

  const ownerBadge = (
    <span className="chip">{publicListing ? "Preview of your listing" : "Preview, not public yet"}</span>
  );

  // Heart in a bordered square so it reads as a second action beside the CTA.
  const favorite = (
    <span className="inline-flex items-center justify-center w-11 h-11 lg:w-[46px] lg:h-[46px] shrink-0 rounded-control border border-line-strong bg-white">
      <FavoriteButton vendorId={vendor.id} initialFavorited={favorited} loggedIn={!!session} />
    </span>
  );

  const ratingRow = hasRating ? (
    <div className="flex items-center gap-1.5 text-sm flex-wrap">
      <span role="img" aria-label={`Rated ${vendor.rating} out of 5`} className="text-gold text-base leading-none">
        ★
      </span>
      <span aria-hidden="true" className="font-semibold">
        {vendor.rating}
      </span>{" "}
      <span className="text-ink-soft">({reviewCountLabel(vendor.reviews_count)})</span>
    </div>
  ) : (
    <p className="text-sm text-ink-soft">New on Vela · no reviews yet</p>
  );

  return (
    <main className="w-full">
      {/* Analytics (P1-12): not for the owner's or an admin's preview; the server re-checks. */}
      {publicListing && !preview ? <VendorBeacon vendorId={vendor.id} /> : null}
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      ) : null}

      {isOwnListing ? (
        <div className="bg-gold-ink text-white text-[13px]">
          <div className="page py-2 flex items-center justify-between gap-x-3 gap-y-1 flex-wrap">
            <span>
              {publicListing
                ? "This is how customers see your profile."
                : "Preview, not public yet. Only you can see this page."}
              {media.hasPending ? " Items marked \u201cUnder review\u201d stay hidden from customers until approved." : ""}
            </span>
            <Link href="/vendor/media" className="font-medium underline underline-offset-2 min-h-11 sm:min-h-0 inline-flex items-center">
              Manage photos
            </Link>
          </div>
        </div>
      ) : null}

      <div
        className="relative h-[168px] sm:h-[240px] flex items-center justify-center overflow-hidden"
        style={media.coverColor ? { backgroundColor: media.coverColor } : undefined}
      >
        {media.coverUrl ? (
          <Image
            src={media.coverUrl}
            alt=""
            fill
            priority
            unoptimized
            sizes="100vw"
            className="object-cover"
          />
        ) : (
          <VendorTile
            category={vendor.category}
            size={64}
            opacity={0.85}
            className="w-full h-[168px] sm:h-[240px]"
          />
        )}
      </div>

      <div className="page relative z-10 -mt-12 sm:-mt-[72px] mb-8 sm:mb-16 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:items-start">
        <div className="card p-5 sm:p-8 shadow-pop">
          <div className="flex items-start gap-4 min-w-0">
            {media.logoUrl ? (
              <Image
                src={media.logoUrl}
                alt={`${vendor.name} logo`}
                width={64}
                height={64}
                unoptimized
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-card object-cover border border-line shrink-0"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              {isOwnListing ? <div className="mb-2.5">{ownerBadge}</div> : null}
              <h1 className="font-display text-display sm:text-[32px] font-semibold leading-tight tracking-[-0.01em] break-words">
                {vendor.name}
              </h1>
              <p className="text-ink-soft text-body mt-1.5">
                {vendor.categoryLabel} · {vendor.location}
                {vendor.years_experience
                  ? ` · ${vendor.years_experience}+ years`
                  : vendor.experience
                    ? ` · ${vendor.experience} experience`
                    : ""}
              </p>
              {vendor.is_demo ? (
                <p className="mt-2.5 rounded-card bg-surface-muted px-3 py-2 text-sm text-ink-soft">
                  <strong className="font-semibold text-foreground">Demo listing.</strong> A sample business that shows how
                  Vela works. It isn&apos;t a real vendor, so don&apos;t book it.
                </p>
              ) : null}
              {vendor.verified_at || vendor.founding_vendor || languages.length ? (
                <ul className="flex flex-wrap gap-1.5 mt-2.5" aria-label="Highlights">
                  {vendor.verified_at ? <li className="chip bg-accent-tint text-accent-hover">Verified business</li> : null}
                  {vendor.founding_vendor ? <li className="chip">Founding vendor</li> : null}
                  {languages.length ? <li className="chip">Speaks {languages.join(", ")}</li> : null}
                </ul>
              ) : null}
              <div className="flex items-center gap-x-4 gap-y-1.5 mt-3 flex-wrap">
                {ratingRow}
                {fromPrice ? (
                  <p className="text-sm">
                    <span className="text-ink-soft">Starting from </span>
                    <span className="text-accent font-semibold">{fromPrice}</span>
                  </p>
                ) : null}
              </div>
              {vendor.tags?.length ? (
                <ul className="flex flex-wrap gap-1.5 mt-3.5" aria-label="Tags">
                  {vendor.tags.map((t) => (
                    <li key={t} className="chip">
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="lg:hidden mt-5 flex items-center gap-3">
            {isOwnListing ? (
              <Link href="/vendor/profile" className="btn btn-primary flex-1 sm:flex-none">
                Edit listing
              </Link>
            ) : (
              <>
                <QuoteButton {...quoteProps} triggerClassName="btn btn-primary flex-1 sm:flex-none sm:px-8" />
                {favorite}
              </>
            )}
          </div>
          {openEnquiry ? <EnquirySentLink enquiry={openEnquiry} className="lg:hidden mt-2" /> : null}
          {contactBlock ? <div className="lg:hidden mt-3 sm:max-w-[360px]">{contactBlock}</div> : null}

          {hasMedia ? (
            <section aria-labelledby="gallery-heading" className="mt-7">
              <h2 id="gallery-heading" className="sr-only">
                Photos and videos
              </h2>
              <Gallery photos={media.photos} videos={media.videos} albums={media.albums} vendorName={vendor.name} />
            </section>
          ) : isOwnListing ? (
            <section aria-labelledby="gallery-heading" className="mt-7">
              <h2 id="gallery-heading" className="sr-only">
                Photos and videos
              </h2>
              <div className="rounded-card border border-dashed border-line-strong bg-surface-muted px-5 py-8 text-center">
                <p className="font-semibold">No photos yet</p>
                <p className="text-sm text-ink-soft mt-1 max-w-[44ch] mx-auto">
                  Profiles with 6 or more photos get far more enquiries. Customers will see your work here.
                </p>
                <Link href="/vendor/media" className="btn btn-primary btn-sm mt-4">
                  Add photos
                </Link>
              </div>
            </section>
          ) : null}

          <section aria-labelledby="about-heading" className="mt-7 pt-7 border-t border-line">
            <h2 id="about-heading" className="font-display text-title font-semibold mb-2.5">
              About
            </h2>
            <p className="text-[15px] leading-relaxed max-w-[68ch]">{vendor.about}</p>
          </section>

          <section aria-labelledby="services-heading" className="mt-7 pt-7 border-t border-line">
            <h2 id="services-heading" className="font-display text-title font-semibold mb-3.5">
              Offerings &amp; pricing
            </h2>
            <OfferingsSection
              data={offerings}
              fallbackPrice={priceText}
              quote={
                isOwnListing
                  ? undefined
                  : (sid) => <QuoteButton {...quoteProps} preselectServiceId={sid} variant="link" label="Request quote" />
              }
            />
          </section>

          <section aria-labelledby="reviews-heading" className="mt-7 pt-7 border-t border-line">
            <h2 id="reviews-heading" className="font-display text-title font-semibold mb-3.5">
              Reviews
            </h2>

            {breakdown.count > 0 && hasRating && (
              <div
                data-testid="rating-summary"
                className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-2 rounded-card bg-surface-muted p-4 sm:p-5"
              >
                <div className="shrink-0 sm:min-w-[96px]">
                  <div className="font-display text-[34px] font-semibold leading-none">{vendor.rating}</div>
                  <div aria-hidden="true" className="text-gold text-sm tracking-[0.1em] mt-1.5">
                    {"★".repeat(Math.max(0, Math.min(5, Math.round(ratingNum))))}
                  </div>
                  <div className="text-caption text-ink-soft mt-0.5">{reviewCountLabel(vendor.reviews_count)}</div>
                </div>
                <ul className="flex-1 space-y-1.5 sm:max-w-[360px]" aria-label="Rating breakdown">
                  {breakdown.stars.map(({ star, count }) => (
                    <li key={star} className="flex items-center gap-2.5 text-caption text-ink-soft">
                      <span className="w-7 shrink-0">{star} ★</span>
                      <span className="flex-1 h-2 bg-white rounded-full overflow-hidden" aria-hidden="true">
                        <span
                          className="block h-full bg-gold rounded-full"
                          style={{ width: `${Math.round((count / breakdown.count) * 100)}%` }}
                        />
                      </span>
                      <span className="w-6 text-right tabular-nums">
                        {count}
                        <span className="sr-only"> {count === 1 ? "review" : "reviews"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {importedCount > 0 && breakdown.count > 0 ? (
              <p className="text-caption text-ink-soft mb-2">
                The overall rating also counts {reviewCountLabel(importedCount)} collected before this business joined Vela.
                The breakdown and the list show the {reviewCountLabel(breakdown.count)} written on Vela.
              </p>
            ) : null}
            {reviews.length < breakdown.count ? (
              <p className="text-caption text-ink-soft mb-2">
                Showing the {reviews.length} most recent of {reviewCountLabel(breakdown.count)}.
              </p>
            ) : null}

            {reviews.length === 0 ? (
              <p className="text-sm text-ink-soft">No reviews yet.</p>
            ) : (
              <ul>
                {reviews.map((r) => {
                  const mine = myReview?.id === r.id;
                  return (
                    <li
                      key={r.id}
                      id={`review-${r.id}`}
                      className={`flex gap-3 py-4 border-b border-line last:border-b-0 ${
                        mine ? "bg-accent-tint/50 -mx-3 px-3 rounded-control" : ""
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="w-9 h-9 shrink-0 rounded-full bg-accent-tint text-accent-hover text-xs font-semibold inline-flex items-center justify-center"
                      >
                        {initials(r.reviewer_name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-3 text-sm font-semibold">
                          <span className="min-w-0">
                            {r.reviewer_name}
                            {mine ? (
                              <span className="ml-2 text-xs font-medium text-accent">Your review</span>
                            ) : null}
                            {r.verified ? (
                              <span className="ml-2 text-xs font-medium text-accent-hover bg-accent-tint rounded-full px-2 py-0.5 align-middle">
                                Verified booking
                              </span>
                            ) : null}
                          </span>
                          <span
                            role="img"
                            aria-label={`${r.rating} out of 5 stars`}
                            className="text-gold shrink-0 tracking-[0.05em]"
                          >
                            {"★".repeat(r.rating)}
                          </span>
                        </div>
                        <time
                          dateTime={new Date(r.created_at).toISOString()}
                          className="block text-caption text-ink-soft mt-0.5"
                        >
                          {formatDate(r.created_at)}
                        </time>
                        <p className="text-sm text-foreground/85 mt-1.5 leading-relaxed max-w-[68ch]">{r.body}</p>
                        {r.vendor_reply ? (
                          <div className="mt-2.5 border-l-2 border-accent/40 pl-3 max-w-[68ch]">
                            <p className="text-caption font-semibold text-foreground">
                              {`Reply from ${vendor.name}`}
                              {r.vendor_reply_at ? (
                                <span className="font-normal text-ink-soft"> · {formatDate(r.vendor_reply_at)}</span>
                              ) : null}
                            </p>
                            <p className="text-sm text-foreground/85 mt-0.5 leading-relaxed whitespace-pre-line">{r.vendor_reply}</p>
                          </div>
                        ) : null}
                        {mine ? null : <ReportReview reviewId={r.id} loginHref={loginHref} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {isOwnListing ? null : myReview ? (
              <p role="status" className="alert-success mt-4">
                Thanks for your review — it&apos;s highlighted above.
              </p>
            ) : canReview ? (
              <div id="write-review">
                <ReviewForm vendorId={vendor.id} />
              </div>
            ) : session ? (
              <p id="write-review" className="text-sm text-ink-soft mt-5 rounded-card border border-dashed border-line-strong px-4 py-3.5">
                {session.role !== "customer"
                  ? "Reviews come from customers who booked or enquired through Vela."
                  : reviewState === "not_yet"
                    ? "You can review this vendor after your event date, once they have replied to your enquiry or you have booked them."
                    : "You can review this vendor after an event you booked with them through Vela."}
              </p>
            ) : (
              <p id="write-review" className="text-sm text-ink-soft mt-5 rounded-card border border-dashed border-line-strong px-4 py-3.5">
                <Link href={loginHref} className="font-medium text-accent underline-offset-2 hover:underline">
                  Sign in
                </Link>{" "}
                to leave a review.
              </p>
            )}
          </section>
        </div>

        <aside className="hidden lg:block sticky top-[calc(var(--header-h)+20px)] mt-[88px] card p-6 shadow-card">
          <div className="text-caption text-ink-soft">Starting from</div>
          <div className="font-display text-accent font-semibold text-heading mt-0.5">{priceText}</div>
          <div className="mt-2">{ratingRow}</div>
          <div className="mt-5 pt-5 border-t border-line">
            {isOwnListing ? (
              <div className="space-y-3">
                {ownerBadge}
                <Link href="/vendor/profile" className="btn btn-primary btn-lg btn-block">
                  Edit listing
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <QuoteButton {...quoteProps} triggerClassName="btn btn-primary btn-lg flex-1" />
                {favorite}
              </div>
            )}
            {openEnquiry ? <EnquirySentLink enquiry={openEnquiry} className="mt-2" /> : null}
            {contactBlock ? <div className="mt-3">{contactBlock}</div> : null}
          </div>
        </aside>
      </div>

      {/* Mobile/tablet action bar (QA-009): sticky, not fixed, and the last child
          of <main>, so it rides the bottom of the screen while the profile
          scrolls, then stops above the site footer instead of covering it. */}
      <div
        data-testid="vendor-mobile-cta"
        className="lg:hidden sticky bottom-0 z-40 bg-white/95 backdrop-blur border-t border-line shadow-[0_-6px_20px_rgb(32_33_36/0.06)] safe-bottom"
      >
        <div className="page pt-3 flex items-center justify-between gap-2.5">
          {waHref && !isOwnListing ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary shrink-0 px-4"
              aria-label={`Chat with ${vendor.name} on WhatsApp`}
            >
              <WhatsappIcon className="w-5 h-5 text-[#128c4b]" />
              WhatsApp
            </a>
          ) : (
            <div className="min-w-0">
              <div className="text-[11px] text-ink-soft">Starting from</div>
              <div className="text-accent font-semibold text-[15px] truncate">{priceText}</div>
            </div>
          )}
          {isOwnListing ? (
            <Link href="/vendor/profile" className="btn btn-primary shrink-0 px-6">
              Edit listing
            </Link>
          ) : (
            <QuoteButton {...quoteProps} label="Get quote" triggerClassName="btn btn-primary flex-1 sm:flex-none px-6 sm:px-8" />
          )}
        </div>
      </div>
    </main>
  );
}
