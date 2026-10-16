import Link from "next/link";
import { findVendors, findAllLocations, findFavoriteVendorIds, DEFAULT_PAGE_SIZE } from "@/lib/db";
import { getSession } from "@/lib/session";
import { VendorTile } from "@/lib/vendorVisuals";
import FavoriteButton from "@/lib/favorite-button";
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
    sortRaw === "reviews" || sortRaw === "priceLow" || sortRaw === "priceHigh" || sortRaw === "trending"
      ? sortRaw
      : "rating";
  const pageParsed = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  const session = await getSession();
  const [{ vendors, total }, locations, favoriteIds] = await Promise.all([
    findVendors({
      query,
      categories: categories.length > 0 ? categories : undefined,
      location,
      minRating: minRating && !Number.isNaN(minRating) ? minRating : undefined,
      sort,
      page,
    }),
    findAllLocations(),
    session ? findFavoriteVendorIds(session.userId) : Promise.resolve(new Set<number>()),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  function pageHref(target: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (key === "page" || value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
    }
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  }

  return (
    <main className="max-w-[1180px] mx-auto px-6 py-6 flex flex-col md:flex-row gap-8 w-full">
      <SearchFilters locations={locations} />

      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink-soft mb-4">
          {total} vendor{total !== 1 ? "s" : ""} found
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
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[17px] font-semibold group-hover:text-accent group-hover:underline">
                      {v.name}
                      {v.verified && (
                        <span className="ml-2 align-middle bg-accent-tint text-accent text-[11px] px-2 py-0.5 rounded-full font-medium">
                          Verified
                        </span>
                      )}
                      {v.featured && (
                        <span className="ml-1.5 align-middle bg-amber-50 text-amber-700 text-[11px] px-2 py-0.5 rounded-full font-medium">
                          Featured
                        </span>
                      )}
                    </div>
                    <FavoriteButton
                      vendorId={v.id}
                      initialFavorited={favoriteIds.has(v.id)}
                      loggedIn={!!session}
                      size="sm"
                    />
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

        {totalPages > 1 && (
          <nav className="flex items-center justify-between mt-6 text-sm" aria-label="Pagination">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="border border-line rounded-md px-3.5 py-2 hover:border-accent">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-soft">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="border border-line rounded-md px-3.5 py-2 hover:border-accent">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </main>
  );
}
