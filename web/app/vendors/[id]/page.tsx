import { notFound } from "next/navigation";
import Link from "next/link";
import { findVendorById, findReviewsByVendor } from "@/lib/db";
import { getSession } from "@/lib/session";
import { VendorTile } from "@/lib/vendorVisuals";
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

  const [reviews, session] = await Promise.all([findReviewsByVendor(vendorId), getSession()]);
  const price = Number(vendor.price);
  const alreadyReviewed = session
    ? reviews.some((r) => r.customer_id === session.userId)
    : false;
  const isOwnListing = session ? vendor.owner_id === session.userId : false;

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
              <div className="flex items-center gap-1.5 mt-2.5 text-sm">
                <span className="text-gold">★</span> {vendor.rating} ({vendor.reviews_count} reviews)
                <span className="bg-accent-tint text-accent text-xs px-2.5 py-0.5 rounded-full font-medium ml-1">
                  Verified
                </span>
              </div>
            </div>
            <QuoteButton vendorId={vendor.id} vendorName={vendor.name} />
          </div>

          <div className="grid grid-cols-4 gap-2 my-6">
            {[0, 1, 2, 3].map((i) => (
              <VendorTile
                key={i}
                category={vendor.category}
                size={28}
                opacity={0.7 + i * 0.08}
                className="w-full h-[110px] rounded-lg"
              />
            ))}
          </div>

          <h2 className="text-base font-semibold mt-6.5 mb-3">About</h2>
          <p className="text-sm leading-relaxed">{vendor.about}</p>

          <h2 className="text-base font-semibold mt-6.5 mb-3">Packages</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <Package title="Basic" price={vendor.price_label} items={["Standard service", "Up to 4 hours", "Digital delivery"]} />
            <Package title="Standard" price={formatPrice(price * 1.6)} items={["Extended coverage", "Priority support", "Extra add-ons"]} />
            <Package title="Premium" price={formatPrice(price * 2.4)} items={["Full-day service", "Dedicated coordinator", "All add-ons included"]} />
          </div>

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
