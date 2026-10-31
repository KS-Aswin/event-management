import Link from "next/link";
import { findVendors, findAllLocations, findFavoriteVendorIds, type VendorRecord } from "@/lib/db";
import { getSession } from "@/lib/session";
import { VendorTile } from "@/lib/vendorVisuals";
import FavoriteButton from "@/lib/favorite-button";
import SearchFilters from "./search-filters";
import SortSelect from "./sort-select";

const PAGE_SIZE = 20;
const RATING_THRESHOLDS = [4.8, 4.7, 4.5];

type Params = { [key: string]: string | string[] | undefined };

/** Repeated params (?q=a&q=b) arrive as arrays; use the first, like searchParams.get(). */
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Trim and collapse inner whitespace so "Kochi " behaves like "Kochi". */
function normalise(q: string | undefined) {
  const n = q?.trim().replace(/\s+/g, " ");
  return n ? n : undefined;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const session = await getSession();

  const [locations, favoriteIds] = await Promise.all([
    findAllLocations(),
    session ? findFavoriteVendorIds(session.userId) : Promise.resolve(new Set<number>()),
  ]);

  const query = normalise(first(sp.q));
  const categories = (Array.isArray(sp.category) ? sp.category : sp.category ? [sp.category] : []).filter(Boolean);
  // Map the location case-insensitively to a known district; ignore unknown values
  // so the select and the results always agree.
  const rawLocation = normalise(first(sp.location))?.toLowerCase();
  const location = rawLocation ? locations.find((l) => l.toLowerCase() === rawLocation) : undefined;
  // Accept only offered thresholds, rounding an off-list value down to one.
  const ratingRaw = parseFloat(first(sp.minRating) ?? "");
  const minRating = Number.isFinite(ratingRaw) ? RATING_THRESHOLDS.find((t) => ratingRaw >= t) : undefined;
  const sortRaw = first(sp.sort) ?? "rating";
  const sort =
    sortRaw === "reviews" || sortRaw === "priceLow" || sortRaw === "priceHigh" ? sortRaw : "rating";
  const pageRaw = parseInt(first(sp.page) ?? "1", 10);

  const vendors = await findVendors({
    query,
    categories: categories.length > 0 ? categories : undefined,
    location,
    minRating,
    sort,
  });

  const total = vendors.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Number.isFinite(pageRaw) ? Math.min(Math.max(1, pageRaw), pageCount) : 1;
  const pageVendors = vendors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Builds a /search URL from the normalised current state with overrides.
  function href(over: { q?: string | null; categories?: string[]; location?: string | null; minRating?: number | null; page?: number }) {
    const p = new URLSearchParams();
    const q = over.q === undefined ? query : over.q;
    const cats = over.categories ?? categories;
    const loc = over.location === undefined ? location : over.location;
    const rating = over.minRating === undefined ? minRating : over.minRating;
    if (q) p.set("q", q);
    cats.forEach((c) => p.append("category", c));
    if (loc) p.set("location", loc);
    if (rating) p.set("minRating", String(rating));
    if (sort !== "rating") p.set("sort", sort);
    if (over.page && over.page > 1) p.set("page", String(over.page));
    const qs = p.toString();
    return qs ? `/search?${qs}` : "/search";
  }

  const chips: { label: string; href: string }[] = [
    ...(query ? [{ label: `“${query}”`, href: href({ q: null }) }] : []),
    ...categories.map((c) => ({ label: c, href: href({ categories: categories.filter((x) => x !== c) }) })),
    ...(location ? [{ label: location, href: href({ location: null }) }] : []),
    ...(minRating ? [{ label: `${minRating}+ rating`, href: href({ minRating: null }) }] : []),
  ];

  const popular =
    total === 0 ? (await findVendors({ sort: "rating" })).filter((v) => !v.status || v.status === "approved").slice(0, 3) : [];

  const renderCard = (v: VendorRecord) => (
    <article key={v.id} className="relative flex flex-row gap-3.5 sm:gap-4.5 py-4.5 border-b border-line group">
      {v.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={v.cover_image_url}
          alt=""
          loading="lazy"
          className="w-24 h-24 sm:w-[180px] sm:h-[130px] rounded-[10px] shrink-0 object-cover bg-gray-100"
        />
      ) : (
        <VendorTile
          category={v.category}
          size={32}
          className="w-24 h-24 sm:w-[180px] sm:h-[130px] rounded-[10px] shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[16px] sm:text-[17px] font-semibold group-hover:text-accent group-hover:underline">
            {/* Stretched link: the whole card is clickable, but the favourite button sits outside it. */}
            <Link href={`/vendors/${v.id}`} className="after:absolute after:inset-0">
              {v.name}
            </Link>
          </h2>
          <div className="relative z-10 shrink-0">
            <FavoriteButton vendorId={v.id} initialFavorited={favoriteIds.has(v.id)} loggedIn={!!session} size="sm" />
          </div>
        </div>
        <div className="text-[13px] text-ink-soft mt-0.5">
          {v.category} · {v.location} · {v.experience} experience
        </div>
        <div className="inline-flex items-center gap-1.5 text-[13px] mt-1.5 sm:mt-2">
          <span className="text-gold" aria-hidden="true">★</span> {v.rating} ({v.reviews_count} reviews)
        </div>
        <div className="hidden sm:flex gap-1.5 flex-wrap mt-2">
          {v.tags.map((t) => (
            <span key={t} className="bg-gray-100 text-[12px] text-ink-soft px-2.5 py-0.5 rounded-full">
              {t}
            </span>
          ))}
        </div>
        <div className="text-sm font-semibold text-accent mt-1.5 sm:mt-2">{v.price_label}</div>
      </div>
    </article>
  );

  return (
    <main className="max-w-[1180px] mx-auto px-4 sm:px-6 py-6 flex flex-col md:flex-row gap-x-8 w-full">
      {/* Query box for phones; the header search box covers md and up. */}
      <form action="/search" method="get" role="search" className="md:hidden mb-4 flex items-center gap-2 border border-line rounded-full px-4 py-2.5 bg-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-soft shrink-0" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          key={query ?? ""}
          name="q"
          type="search"
          defaultValue={query ?? ""}
          aria-label="Search vendors"
          placeholder="Search vendors"
          enterKeyHint="search"
          className="flex-1 min-w-0 outline-none text-base bg-transparent"
        />
        {categories.map((c) => (
          <input key={c} type="hidden" name="category" value={c} />
        ))}
        {location && <input type="hidden" name="location" value={location} />}
        {minRating && <input type="hidden" name="minRating" value={String(minRating)} />}
        {sort !== "rating" && <input type="hidden" name="sort" value={sort} />}
        <button type="submit" className="text-sm text-accent font-medium px-1">
          Search
        </button>
      </form>

      <SearchFilters
        locations={locations}
        activeLocation={location ?? ""}
        activeMinRating={minRating ? String(minRating) : "0"}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <p className="text-sm text-ink-soft" aria-live="polite">
            {total} vendor{total !== 1 ? "s" : ""}
            {query ? <> for &ldquo;{query}&rdquo;</> : " found"}
          </p>
          <SortSelect value={sort} />
        </div>

        {chips.length > 0 && (
          <ul className="flex gap-2 flex-wrap mb-3" aria-label="Active filters">
            {chips.map((c) => (
              <li key={c.label}>
                <Link
                  href={c.href}
                  className="inline-flex items-center gap-1.5 bg-accent-tint text-accent text-[12.5px] rounded-full pl-3 pr-2 py-1 hover:underline"
                  aria-label={`Remove filter ${c.label}`}
                >
                  {c.label}
                  <span aria-hidden="true">×</span>
                </Link>
              </li>
            ))}
            {chips.length > 1 && (
              <li>
                <Link href={href({ q: null, categories: [], location: null, minRating: null })} className="inline-flex text-[12.5px] text-accent py-1 px-1 hover:underline">
                  Clear all
                </Link>
              </li>
            )}
          </ul>
        )}

        {total === 0 ? (
          <div className="py-12 text-center text-ink-soft">
            <p>No vendors match {chips.length > 0 ? "these filters" : "yet"}.</p>
            {chips.length > 0 && (
              <p className="mt-2 text-sm">
                Remove a filter above, or{" "}
                <Link href="/search" className="text-accent hover:underline">
                  browse all vendors
                </Link>
                .
              </p>
            )}
            {popular.length > 0 && (
              <div className="text-left mt-10">
                <h2 className="text-sm uppercase tracking-wide text-ink-soft mb-1">Popular vendors</h2>
                <div>{popular.map(renderCard)}</div>
              </div>
            )}
          </div>
        ) : (
          <div>{pageVendors.map(renderCard)}</div>
        )}

        {pageCount > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 mt-6 text-sm">
            {page > 1 ? (
              <Link href={href({ page: page - 1 })} className="px-3.5 py-2 border border-line rounded-md hover:border-accent">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-soft">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={href({ page: page + 1 })} className="px-3.5 py-2 border border-line rounded-md hover:border-accent">
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
