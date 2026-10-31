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
    <article
      key={v.id}
      className="relative flex flex-row gap-3.5 sm:gap-5 py-4 sm:p-4 sm:-mx-4 border-b border-line sm:border-b-0 sm:rounded-card sm:hover:bg-surface-muted transition-colors group has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent"
    >
      {v.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={v.cover_image_url}
          alt=""
          loading="lazy"
          className="w-[88px] h-[88px] sm:w-[200px] sm:h-[140px] rounded-card shrink-0 object-cover bg-surface-muted"
        />
      ) : (
        <VendorTile
          category={v.category}
          size={32}
          className="w-[88px] h-[88px] sm:w-[200px] sm:h-[140px] rounded-card shrink-0"
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[16px] sm:text-[18px] leading-snug font-semibold tracking-[-0.01em] pt-0.5 group-hover:text-accent">
            {/* Stretched link: the whole card is clickable, but the favourite button sits outside it. */}
            <Link href={`/vendors/${v.id}`} className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
              {v.name}
            </Link>
          </h2>
          <div className="relative z-10 shrink-0">
            <FavoriteButton vendorId={v.id} initialFavorited={favoriteIds.has(v.id)} loggedIn={!!session} size="sm" />
          </div>
        </div>
        <div className="text-[13px] sm:text-sm text-ink-soft mt-0.5 line-clamp-2">
          {v.category} · {v.location} · {v.experience} experience
        </div>
        <div className="flex items-center gap-1.5 text-[13px] sm:text-sm mt-1.5">
          {v.reviews_count > 0 ? (
            <>
              <span className="text-gold" aria-hidden="true">★</span>
              <span className="font-medium text-foreground">{v.rating}</span>
              <span className="text-ink-soft">({v.reviews_count} reviews)</span>
            </>
          ) : (
            <span className="text-ink-soft">New on Vela · no reviews yet</span>
          )}
        </div>
        {v.tags.length > 0 && (
          <div className="hidden sm:flex gap-1.5 flex-wrap mt-2.5">
            {v.tags.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="text-sm sm:text-[15px] font-semibold text-accent mt-1.5 sm:mt-auto sm:pt-2.5">{v.price_label}</div>
      </div>
    </article>
  );

  return (
    <main className="page w-full pt-4 pb-10 md:pt-8 md:pb-16 flex flex-col md:flex-row md:items-start gap-x-10">
      <SearchFilters
        locations={locations}
        activeLocation={location ?? ""}
        activeMinRating={minRating ? String(minRating) : "0"}
        mobileToolbar={<SortSelect value={sort} />}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 mb-3 md:mb-4 min-h-6 md:min-h-10 flex-wrap">
          <p className="text-sm md:text-[15px] text-ink-soft" aria-live="polite">
            <span className="font-semibold text-foreground">{total}</span> vendor{total !== 1 ? "s" : ""}
            {query ? <> for &ldquo;<span className="text-foreground">{query}</span>&rdquo;</> : " found"}
          </p>
          <div className="hidden md:block">
            <SortSelect value={sort} />
          </div>
        </div>

        {chips.length > 0 && (
          <ul className="flex gap-2 flex-wrap items-center mb-2 md:mb-3" aria-label="Active filters">
            {chips.map((c) => (
              <li key={c.label}>
                <Link
                  href={c.href}
                  className="inline-flex items-center gap-1 bg-accent-tint text-accent text-[13px] font-medium rounded-full pl-3.5 pr-2 min-h-11 sm:min-h-9 border border-transparent hover:border-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  aria-label={`Remove filter ${c.label}`}
                >
                  {c.label}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </Link>
              </li>
            ))}
            {chips.length > 1 && (
              <li>
                <Link href={href({ q: null, categories: [], location: null, minRating: null })} className="inline-flex items-center min-h-11 sm:min-h-9 text-[13px] font-medium text-accent px-2 rounded-full hover:underline">
                  Clear all
                </Link>
              </li>
            )}
          </ul>
        )}

        {total === 0 ? (
          <div>
            <div className="mt-2 rounded-card bg-surface-muted px-5 py-10 sm:py-12 text-center text-ink-soft">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-accent shadow-card" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5M8.5 11h5" />
                </svg>
              </span>
              <p className="text-base sm:text-lg font-semibold text-foreground">No vendors match {chips.length > 0 ? "these filters" : "yet"}.</p>
            {chips.length > 0 && (
              <p className="mt-2 text-sm max-w-[42ch] mx-auto">
                Remove a filter above, or{" "}
                <Link href="/search" className="text-accent font-medium underline underline-offset-2 hover:no-underline">
                  browse all vendors
                </Link>
                .
              </p>
            )}
            </div>
            {popular.length > 0 && (
              <div className="mt-8 sm:mt-10">
                <h2 className="eyebrow mb-1 sm:mb-2">Popular vendors</h2>
                <div>{popular.map(renderCard)}</div>
              </div>
            )}
          </div>
        ) : (
          <div>{pageVendors.map(renderCard)}</div>
        )}

        {pageCount > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 mt-8 text-sm">
            {page > 1 ? (
              <Link href={href({ page: page - 1 })} className="btn btn-secondary">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-soft">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={href({ page: page + 1 })} className="btn btn-secondary">
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
