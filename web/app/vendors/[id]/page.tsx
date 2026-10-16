import { notFound } from "next/navigation";
import Link from "next/link";
import { findVendorById, findReviewsByVendor, isFavorited, recordVendorView } from "@/lib/db";
import { getSession } from "@/lib/session";
import { listPackages, listPortfolio, listUnavailableDates } from "@/lib/vendor-content";
import { VendorTile } from "@/lib/vendorVisuals";
import FavoriteButton from "@/lib/favorite-button";
import QuoteButton from "./quote-button";
import ReviewForm from "./review-form";

function formatPrice(n: number) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export default async function VendorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const vendorId = parseInt(id, 10);
  if (Number.isNaN(vendorId)) notFound();

  const vendor = await findVendorById(vendorId);
  if (!vendor) notFound();

  const session = await getSession();
  const isOwnListing = session ? vendor.owner_id === session.userId : false;
  // Hidden listings are visible only to their owner and admins.
  if (!vendor.published && !isOwnListing && session?.role !== "admin") notFound();

  // Count the visit (the owner looking at their own page doesn't count).
  if (!isOwnListing) {
    try {
      await recordVendorView(vendorId, session?.userId ?? null);
    } catch (err) {
      console.error("[vendor view] could not record:", err);
    }
  }

  const [reviews, packages, portfolio, unavailableDates] = await Promise.all([
    findReviewsByVendor(vendorId),
    listPackages(vendorId),
    listPortfolio(vendorId),
    listUnavailableDates(vendorId),
  ]);
  const alreadyReviewed = session
    ? reviews.some((r) => r.customer_id === session.userId)
    : false;
  const favorited = session ? await isFavorited(session.userId, vendorId) : false;

  return (
    <main className="w-full">
      <div className="h-[260px] flex items-center justify-center">
        <VendorTile category={vendor.category} size={72} opacity={0.85} className="w-full h-[260px]" />
      </div>

      <div className="max-w-[900px] mx-auto px-6 -mt-[60px] mb-14">
        <div className="bg-white border border-line rounded-xl p-7 shadow-[0_4px_18px_rgba(0,0,0,0.06)]">
          <div className="flex justify-between items-start gap-5 flex-wrap">
            <div>
              <h1 className="text-[26px] font-semibold">{vendor.name}</h1>
              <p className="text-ink-soft text-sm mt-1">
                {vendor.category} · {vendor.location} · {vendor.experience} experience
              </p>
              <div className="flex items-center gap-1.5 mt-2.5 text-sm flex-wrap">
                <span className="text-gold">★</span> {vendor.rating} ({vendor.reviews_count} reviews)
                {vendor.verified && (
                  <span className="bg-accent-tint text-accent text-xs px-2.5 py-0.5 rounded-full font-medium ml-1">
                    Verified
                  </span>
                )}
                {vendor.featured && (
                  <span className="bg-amber-50 text-amber-700 text-xs px-2.5 py-0.5 rounded-full font-medium">
                    Featured
                  </span>
                )}
              </div>
              <div className="text-sm font-semibold text-accent mt-2">{vendor.price_label}</div>
            </div>
            <div className="flex items-center gap-3">
              <FavoriteButton vendorId={vendor.id} initialFavorited={favorited} loggedIn={!!session} />
              {!isOwnListing && <QuoteButton vendorId={vendor.id} vendorName={vendor.name} />}
            </div>
          </div>

          {portfolio.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-6">
              {portfolio.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.id}
                  src={p.url}
                  alt={p.caption ?? `${vendor.name} portfolio photo`}
                  loading="lazy"
                  className="w-full h-[130px] object-cover rounded-lg"
                />
              ))}
            </div>
          )}

          <h2 className="text-base font-semibold mt-6.5 mb-3">About</h2>
          <p className="text-sm leading-relaxed whitespace-pre-line">{vendor.about}</p>

          <h2 className="text-base font-semibold mt-6.5 mb-3">Packages</h2>
          {packages.length === 0 ? (
            <p className="text-sm text-ink-soft">
              {vendor.name} hasn&apos;t listed packages yet — request a quote to get exact pricing.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              {packages.map((pkg) => (
                <Package key={pkg.id} title={pkg.name} price={formatPrice(pkg.price)} items={pkg.items} />
              ))}
            </div>
          )}

          {unavailableDates.length > 0 && (
            <>
              <h2 className="text-base font-semibold mt-6.5 mb-3">Not available on</h2>
              <p className="text-sm text-ink-soft">
                {unavailableDates
                  .slice(0, 12)
                  .map((d) =>
                    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
                      timeZone: "UTC",
                      day: "numeric",
                      month: "short",
                    })
                  )
                  .join(" · ")}
                {unavailableDates.length > 12 ? ` · and ${unavailableDates.length - 12} more` : ""}
              </p>
            </>
          )}

          <h2 className="text-base font-semibold mt-6.5 mb-3">Reviews</h2>

          {isOwnListing ? null : alreadyReviewed ? (
            <p className="text-sm text-ink-soft mb-4">You&apos;ve already reviewed this vendor.</p>
          ) : session ? (
            <ReviewForm vendorId={vendor.id} />
          ) : (
            <p className="text-sm text-ink-soft mb-4">
              <Link href="/login" className="text-accent hover:underline">
                Sign in
              </Link>{" "}
              to leave a review.
            </p>
          )}

          {reviews.length === 0 ? (
            <p className="text-sm text-ink-soft">No reviews yet.</p>
          ) : (
            reviews.map((r) => (
              <div key={r.id} className="py-3.5 border-b border-line last:border-b-0">
                <div className="flex justify-between text-sm font-semibold">
                  <span>{r.reviewer_name}</span>
                  <span className="text-gold">{"★".repeat(r.rating)}</span>
                </div>
                <div className="text-[13px] text-ink-soft mt-1 leading-relaxed">{r.body}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

function Package({ title, price, items }: { title: string; price: string; items: string[] }) {
  return (
    <div className="border border-line rounded-lg p-4">
      <h5 className="text-sm font-semibold mb-1.5">{title}</h5>
      <div className="text-accent font-semibold text-[15px] mb-2">{price}</div>
      <ul className="text-[13px] text-ink-soft space-y-1.5">
        {items.map((it) => (
          <li key={it}>✓ {it}</li>
        ))}
      </ul>
    </div>
  );
}
