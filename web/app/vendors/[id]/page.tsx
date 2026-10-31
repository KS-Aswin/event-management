import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  findVendorById,
  findReviewsByVendor,
  findServicesByVendor,
  findPortfolioByVendor,
  isFavorited,
  type VendorRecord,
} from "@/lib/db";
import { getSession, type SessionPayload } from "@/lib/session";
import { VendorTile } from "@/lib/vendorVisuals";
import FavoriteButton from "@/lib/favorite-button";
import QuoteButton from "./quote-button";
import ReviewForm from "./review-form";

const MAX_INT4 = 2147483647;

/** Accepts only plain positive integers that fit a Postgres int4 ("1abc" and "1e3" are rejected). */
function parseId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= MAX_INT4 ? n : null;
}

function formatPrice(n: number) {
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
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

  const [reviews, services, portfolio, session] = await Promise.all([
    findReviewsByVendor(vendorId),
    findServicesByVendor(vendorId),
    findPortfolioByVendor(vendorId),
    getSession(),
  ]);
  if (!canView(vendor, session)) notFound();

  const publicListing = isPublic(vendor);
  const myReview = session ? reviews.find((r) => r.customer_id === session.userId) : undefined;
  const isOwnListing = session ? vendor.owner_id === session.userId : false;
  const favorited = session && !isOwnListing ? await isFavorited(session.userId, vendorId) : false;
  const images = portfolio.filter((p) => p.media_type === "image");
  const quoteServices = services.map((s) => ({ id: s.id, title: s.title }));
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
        image: vendor.cover_image_url || vendor.logo_url || undefined,
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
    <span className="chip">{publicListing ? "Preview of your listing" : `Preview · ${vendor.status}`}</span>
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

      <div className="relative h-[168px] sm:h-[240px] flex items-center justify-center overflow-hidden">
        {vendor.cover_image_url ? (
          <Image
            src={vendor.cover_image_url}
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
            {vendor.logo_url ? (
              <Image
                src={vendor.logo_url}
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
                {vendor.category} · {vendor.location} · {vendor.experience} experience
              </p>
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
              <Link href="/dashboard/edit-listing" className="btn btn-primary flex-1 sm:flex-none">
                Edit listing
              </Link>
            ) : (
              <>
                <QuoteButton {...quoteProps} triggerClassName="btn btn-primary flex-1 sm:flex-none sm:px-8" />
                {favorite}
              </>
            )}
          </div>

          {images.length > 0 && (
            <section aria-labelledby="gallery-heading" className="mt-7">
              <h2 id="gallery-heading" className="sr-only">
                Portfolio
              </h2>
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {images.map((p) => (
                  <li
                    key={p.id}
                    className="relative aspect-[4/3] rounded-control overflow-hidden bg-surface-muted"
                  >
                    <Image
                      src={p.media_url}
                      alt={p.caption || `${vendor.name} portfolio photo`}
                      fill
                      unoptimized
                      sizes="(min-width: 640px) 33vw, 50vw"
                      className="object-cover"
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="about-heading" className="mt-7 pt-7 border-t border-line">
            <h2 id="about-heading" className="font-display text-title font-semibold mb-2.5">
              About
            </h2>
            <p className="text-[15px] leading-relaxed max-w-[68ch]">{vendor.about}</p>
          </section>

          <section aria-labelledby="services-heading" className="mt-7 pt-7 border-t border-line">
            <h2 id="services-heading" className="font-display text-title font-semibold mb-3.5">
              Services &amp; pricing
            </h2>
            <ul className="border border-line rounded-card divide-y divide-line overflow-hidden">
              {services.length > 0 ? (
                services.map((s) => (
                  <li key={s.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-semibold">{s.title}</h3>
                        <div className="text-caption text-ink-soft mt-0.5">{s.category}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-accent font-semibold text-[15px]">{formatPrice(s.price_from)}</div>
                        <div className="text-caption text-ink-soft">onwards / {s.price_unit}</div>
                      </div>
                    </div>
                    {s.description ? (
                      <p className="text-sm text-ink-soft mt-2 leading-relaxed max-w-[68ch]">{s.description}</p>
                    ) : null}
                    {!isOwnListing ? (
                      <div className="mt-2 -mb-1.5">
                        <QuoteButton
                          {...quoteProps}
                          preselectServiceId={s.id}
                          variant="link"
                          label="Request quote"
                        />
                      </div>
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="flex items-start justify-between gap-4 p-4 sm:p-5">
                  <span className="text-sm text-ink-soft">Starting from</span>
                  <span className="text-accent font-semibold text-sm text-right">{vendor.price_label}</span>
                </li>
              )}
            </ul>
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
                <Link href="/dashboard/edit-listing" className="btn btn-primary btn-lg btn-block">
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
            <Link href="/dashboard/edit-listing" className="btn btn-primary shrink-0 px-6">
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
