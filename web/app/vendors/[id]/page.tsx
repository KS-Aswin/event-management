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

  const actions = isOwnListing ? (
    <div className="flex items-center gap-2.5 flex-wrap">
      <span className="bg-gray-100 text-ink-soft text-xs px-2.5 py-1 rounded-full font-medium">
        {publicListing ? "Preview of your listing" : `Preview · ${vendor.status}`}
      </span>
      <Link
        href="/dashboard/edit-listing"
        className="px-5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium"
      >
        Edit listing
      </Link>
    </div>
  ) : (
    <div className="flex items-center gap-3">
      <FavoriteButton vendorId={vendor.id} initialFavorited={favorited} loggedIn={!!session} />
      <QuoteButton {...quoteProps} />
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

      <div className="relative h-[260px] flex items-center justify-center overflow-hidden">
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
          <VendorTile category={vendor.category} size={72} opacity={0.85} className="w-full h-[260px]" />
        )}
      </div>

      <div className="relative z-10 max-w-[1100px] mx-auto px-4 sm:px-6 -mt-[60px] mb-14 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6 lg:items-start">
        <div className="bg-white border border-line rounded-xl p-5 sm:p-7 shadow-[0_4px_18px_rgba(0,0,0,0.06)]">
          <div className="flex justify-between items-start gap-5 flex-wrap">
            <div className="flex items-start gap-3.5 min-w-0">
              {vendor.logo_url ? (
                <Image
                  src={vendor.logo_url}
                  alt={`${vendor.name} logo`}
                  width={56}
                  height={56}
                  unoptimized
                  className="w-14 h-14 rounded-lg object-cover border border-line shrink-0"
                />
              ) : null}
              <div className="min-w-0">
                <h1 className="text-[26px] font-semibold">{vendor.name}</h1>
                <p className="text-ink-soft text-sm mt-1">
                  {vendor.category} · {vendor.location} · {vendor.experience} experience
                </p>
                <div className="flex items-center gap-1.5 mt-2.5 text-sm flex-wrap">
                  <span role="img" aria-label={`Rated ${vendor.rating} out of 5`} className="text-gold">
                    ★
                  </span>
                  <span aria-hidden="true">{vendor.rating}</span> ({vendor.reviews_count} reviews)
                </div>
                {vendor.price_label ? (
                  <p className="text-sm mt-2">
                    <span className="text-ink-soft">Starting from </span>
                    <span className="text-accent font-semibold">{vendor.price_label}</span>
                  </p>
                ) : null}
                {vendor.tags?.length ? (
                  <ul className="flex flex-wrap gap-1.5 mt-2.5" aria-label="Tags">
                    {vendor.tags.map((t) => (
                      <li key={t} className="text-xs bg-gray-100 text-ink-soft px-2.5 py-0.5 rounded-full">
                        {t}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="lg:hidden">{actions}</div>
          </div>

          {images.length > 0 && (
            <section aria-labelledby="gallery-heading" className="my-6">
              <h2 id="gallery-heading" className="sr-only">
                Portfolio
              </h2>
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {images.map((p) => (
                  <li key={p.id} className="relative h-[130px] sm:h-[150px] rounded-lg overflow-hidden bg-gray-100">
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

          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-base font-semibold mt-6.5 mb-3">
              About
            </h2>
            <p className="text-sm leading-relaxed">{vendor.about}</p>
          </section>

          <section aria-labelledby="services-heading">
            <h2 id="services-heading" className="text-base font-semibold mt-6.5 mb-3">
              Services &amp; pricing
            </h2>
            <ul className="border border-line rounded-lg divide-y divide-line">
              {services.length > 0 ? (
                services.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">{s.title}</h3>
                      <div className="text-xs text-ink-soft mt-0.5">{s.category}</div>
                      {s.description ? (
                        <p className="text-[13px] text-ink-soft mt-1.5 leading-relaxed">{s.description}</p>
                      ) : null}
                      {!isOwnListing ? (
                        <div className="mt-2">
                          <QuoteButton
                            {...quoteProps}
                            preselectServiceId={s.id}
                            variant="link"
                            label="Request quote"
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className="text-accent font-semibold text-sm shrink-0 text-right">
                      {formatPrice(s.price_from)}
                      <div className="text-xs text-ink-soft font-normal">onwards / {s.price_unit}</div>
                    </div>
                  </li>
                ))
              ) : (
                <li className="flex items-start justify-between gap-4 p-4">
                  <span className="text-sm text-ink-soft">Starting from</span>
                  <span className="text-accent font-semibold text-sm text-right">{vendor.price_label}</span>
                </li>
              )}
            </ul>
          </section>

          <section aria-labelledby="reviews-heading">
            <h2 id="reviews-heading" className="text-base font-semibold mt-6.5 mb-3">
              Reviews
            </h2>

            {reviews.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
                <div className="shrink-0">
                  <div className="text-[28px] font-semibold leading-none">{vendor.rating}</div>
                  <div className="text-xs text-ink-soft mt-1">{vendor.reviews_count} reviews</div>
                </div>
                <ul className="flex-1 space-y-1 max-w-[320px]" aria-label="Rating breakdown">
                  {distribution.map(({ star, count }) => (
                    <li key={star} className="flex items-center gap-2 text-xs text-ink-soft">
                      <span className="w-7 shrink-0">{star} ★</span>
                      <span className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden" aria-hidden="true">
                        <span
                          className="block h-full bg-gold"
                          style={{ width: `${Math.round((count / reviews.length) * 100)}%` }}
                        />
                      </span>
                      <span className="w-6 text-right">
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
                      className={`py-3.5 border-b border-line last:border-b-0 ${
                        mine ? "bg-accent-tint/50 -mx-3 px-3 rounded-md" : ""
                      }`}
                    >
                      <div className="flex justify-between gap-3 text-sm font-semibold">
                        <span>
                          {r.reviewer_name}
                          {mine ? (
                            <span className="ml-2 text-xs font-medium text-accent">Your review</span>
                          ) : null}
                        </span>
                        <span role="img" aria-label={`${r.rating} out of 5 stars`} className="text-gold shrink-0">
                          {"★".repeat(r.rating)}
                        </span>
                      </div>
                      <time dateTime={new Date(r.created_at).toISOString()} className="block text-xs text-ink-soft mt-0.5">
                        {formatDate(r.created_at)}
                      </time>
                      <div className="text-[13px] text-ink-soft mt-1 leading-relaxed">{r.body}</div>
                    </li>
                  );
                })}
              </ul>
            )}

            {isOwnListing ? null : myReview ? (
              <p role="status" className="text-sm text-accent bg-accent-tint rounded-md px-3.5 py-3 mt-4">
                Thanks for your review — it&apos;s highlighted above.
              </p>
            ) : session ? (
              <ReviewForm vendorId={vendor.id} />
            ) : (
              <p className="text-sm text-ink-soft mt-4">
                <Link href={loginHref} className="text-accent hover:underline">
                  Sign in
                </Link>{" "}
                to leave a review.
              </p>
            )}
          </section>
        </div>

        <aside className="hidden lg:block sticky top-20 mt-[60px] bg-white border border-line rounded-xl p-5 shadow-[0_4px_18px_rgba(0,0,0,0.06)]">
          <div className="text-xs text-ink-soft">Starting from</div>
          <div className="text-accent font-semibold text-lg mb-4">{vendor.price_label}</div>
          {actions}
        </aside>
      </div>

      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-ink-soft">Starting from</div>
          <div className="text-accent font-semibold text-sm truncate">{vendor.price_label}</div>
        </div>
        {isOwnListing ? (
          <Link
            href="/dashboard/edit-listing"
            className="px-5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium shrink-0"
          >
            Edit listing
          </Link>
        ) : (
          <QuoteButton {...quoteProps} />
        )}
      </div>
    </main>
  );
}
