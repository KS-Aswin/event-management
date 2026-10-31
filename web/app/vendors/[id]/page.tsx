import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { findVendorById, findReviewsByVendor, isFavorited, type VendorRecord } from "@/lib/db";
import { getSession, type SessionPayload } from "@/lib/session";
import { VendorTile } from "@/lib/vendorVisuals";
import FavoriteButton from "@/lib/favorite-button";
import QuoteButton from "./quote-button";
import ReviewForm from "./review-form";
import Gallery from "./gallery";
import OfferingsSection from "./offerings";
import { loadProfileMedia, loadProfileOfferings } from "./profile-data";

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

const loadVendor = cache(async (rawId: string) => {
  const vendorId = parseId(rawId);
  if (vendorId === null) return null;
  return findVendorById(vendorId);
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
    vendor.about?.slice(0, 160) || `${vendor.category} in ${vendor.location}. ${vendor.price_label}.`;
  return {
    title: `${vendor.name} — ${vendor.category} in ${vendor.location}`,
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
  const [reviews, media, offerings] = await Promise.all([
    findReviewsByVendor(vendorId),
    loadProfileMedia(vendor, preview),
    loadProfileOfferings(vendorId),
  ]);

  const publicListing = isPublic(vendor);
  const myReview = session ? reviews.find((r) => r.customer_id === session.userId) : undefined;
  const favorited = session && !isOwnListing ? await isFavorited(session.userId, vendorId) : false;
  const quoteServices = offerings.quoteable;
  const hasMedia = media.photos.length > 0 || media.videos.length > 0;
  const languages = (vendor.languages ?? []).filter(Boolean);
  const loginHref = `/login?next=${encodeURIComponent(`/vendors/${vendorId}`)}`;
  const ratingNum = Number(vendor.rating);

  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));

  const quoteProps = {
    vendorId: vendor.id,
    vendorName: vendor.name,
    services: quoteServices,
    defaultName: session?.name ?? "",
    loggedIn: !!session,
  };

  const jsonLd = publicListing
    ? {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: vendor.name,
        description: vendor.about || undefined,
        image: media.coverUrl || media.logoUrl || undefined,
        priceRange: vendor.price_label || undefined,
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

  const ratingRow = (
    <div className="flex items-center gap-1.5 text-sm flex-wrap">
      <span role="img" aria-label={`Rated ${vendor.rating} out of 5`} className="text-gold text-base leading-none">
        ★
      </span>
      <span aria-hidden="true" className="font-semibold">
        {vendor.rating}
      </span>{" "}
      <span className="text-ink-soft">({vendor.reviews_count} reviews)</span>
    </div>
  );

  return (
    <main className="w-full pb-24 lg:pb-0">
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
                {vendor.category} · {vendor.location}
                {vendor.years_experience
                  ? ` · ${vendor.years_experience}+ years`
                  : vendor.experience
                    ? ` · ${vendor.experience} experience`
                    : ""}
              </p>
              {vendor.verified_at || vendor.founding_vendor || languages.length ? (
                <ul className="flex flex-wrap gap-1.5 mt-2.5" aria-label="Highlights">
                  {vendor.verified_at ? <li className="chip bg-accent-tint text-accent-hover">Verified business</li> : null}
                  {vendor.founding_vendor ? <li className="chip">Founding vendor</li> : null}
                  {languages.length ? <li className="chip">Speaks {languages.join(", ")}</li> : null}
                </ul>
              ) : null}
              <div className="flex items-center gap-x-4 gap-y-1.5 mt-3 flex-wrap">
                {ratingRow}
                {vendor.price_label ? (
                  <p className="text-sm">
                    <span className="text-ink-soft">Starting from </span>
                    <span className="text-accent font-semibold">{vendor.price_label}</span>
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
              fallbackPrice={vendor.price_label}
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

            {reviews.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-2 rounded-card bg-surface-muted p-4 sm:p-5">
                <div className="shrink-0 sm:min-w-[96px]">
                  <div className="font-display text-[34px] font-semibold leading-none">{vendor.rating}</div>
                  <div aria-hidden="true" className="text-gold text-sm tracking-[0.1em] mt-1.5">
                    {"★".repeat(Math.max(0, Math.min(5, Math.round(ratingNum))))}
                  </div>
                  <div className="text-caption text-ink-soft mt-0.5">{vendor.reviews_count} reviews</div>
                </div>
                <ul className="flex-1 space-y-1.5 sm:max-w-[360px]" aria-label="Rating breakdown">
                  {distribution.map(({ star, count }) => (
                    <li key={star} className="flex items-center gap-2.5 text-caption text-ink-soft">
                      <span className="w-7 shrink-0">{star} ★</span>
                      <span className="flex-1 h-2 bg-white rounded-full overflow-hidden" aria-hidden="true">
                        <span
                          className="block h-full bg-gold rounded-full"
                          style={{ width: `${Math.round((count / reviews.length) * 100)}%` }}
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

            {reviews.length === 0 ? (
              <p className="text-sm text-ink-soft">No reviews yet.</p>
            ) : (
              <ul>
                {reviews.map((r) => {
                  const mine = myReview?.id === r.id;
                  return (
                    <li
                      key={r.id}
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
            ) : session ? (
              <ReviewForm vendorId={vendor.id} />
            ) : (
              <p className="text-sm text-ink-soft mt-5 rounded-card border border-dashed border-line-strong px-4 py-3.5">
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
          <div className="font-display text-accent font-semibold text-heading mt-0.5">{vendor.price_label}</div>
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
          </div>
        </aside>
      </div>

      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line shadow-[0_-6px_20px_rgb(32_33_36/0.06)] safe-bottom">
        <div className="page pt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-ink-soft">Starting from</div>
            <div className="text-accent font-semibold text-[15px] truncate">{vendor.price_label}</div>
          </div>
          {isOwnListing ? (
            <Link href="/vendor/profile" className="btn btn-primary shrink-0 px-6">
              Edit listing
            </Link>
          ) : (
            <QuoteButton {...quoteProps} triggerClassName="btn btn-primary shrink-0 px-6 sm:px-8" />
          )}
        </div>
      </div>
    </main>
  );
}
