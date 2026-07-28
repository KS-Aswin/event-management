import Link from "next/link";
import { findVendors, findAllLocations } from "@/lib/db";
import { VendorTile } from "@/lib/vendorVisuals";
import SearchFilters from "./search-filters";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;

  const query = typeof sp.q === "string" ? sp.q : undefined;
  const categories = Array.isArray(sp.category) ? sp.category : sp.category ? [sp.category] : [];
  const location = typeof sp.location === "string" ? sp.location : undefined;
  const minRating = typeof sp.minRating === "string" ? parseFloat(sp.minRating) : undefined;
  const sortRaw = typeof sp.sort === "string" ? sp.sort : "rating";
  const sort =
    sortRaw === "reviews" || sortRaw === "priceLow" || sortRaw === "priceHigh" ? sortRaw : "rating";

  const [vendors, locations] = await Promise.all([
    findVendors({ query, categories: categories.length > 0 ? categories : undefined, location, minRating, sort }),
    findAllLocations(),
  ]);

  return (
    <main className="max-w-[1180px] mx-auto px-6 py-6 flex flex-col md:flex-row gap-8 w-full">
      <SearchFilters locations={locations} />

      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink-soft mb-4">
          {vendors.length} vendor{vendors.length !== 1 ? "s" : ""} found
        </p>

        {vendors.length === 0 ? (
          <div className="py-16 text-center text-ink-soft">
            No vendors match these filters. Try widening your search.
          </div>
        ) : (
          <div>
            {vendors.map((v) => (
              <Link
                key={v.id}
                href={`/vendors/${v.id}`}
                className="flex flex-col sm:flex-row gap-4.5 py-4.5 border-b border-line group"
              >
                <VendorTile
                  category={v.category}
                  size={40}
                  className="w-full sm:w-[180px] h-[180px] sm:h-[130px] rounded-[10px] shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[17px] font-semibold group-hover:text-accent group-hover:underline">
                    {v.name}
                  </div>
                  <div className="text-[13px] text-ink-soft mt-0.5">
                    {v.category} · {v.location} · {v.experience} experience
                  </div>
                  <div className="inline-flex items-center gap-1.5 text-[13px] mt-2">
                    <span className="text-gold">★</span> {v.rating} ({v.reviews_count} reviews)
                  </div>
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    {v.tags.map((t) => (
                      <span key={t} className="bg-gray-100 text-[12px] text-ink-soft px-2.5 py-0.5 rounded-full">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="text-sm font-semibold text-accent mt-2">{v.price_label}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
