import type { Metadata } from "next";
import Link from "next/link";
import { findFavoriteVendorIds, pool, type VendorRecord } from "@/lib/db";
import { getSession } from "@/lib/session";
import { categoryLabeller, getTaxonomy, resolveCategoryName } from "@/lib/taxonomy";
import {
  nearbyDistrictCounts,
  parseSearchParams,
  resolveDistrict,
  searchOfferings,
  searchVendors,
  todayInIndia,
  unitPhrase,
  DEFAULT_PAGE_SIZE,
  type SearchFilters,
  type SearchOffering,
} from "@/lib/search";
import CardImage from "./card-image";
import { findCardMedia } from "./card-media";
import FavoriteButton from "@/lib/favorite-button";
import SearchFilterPanel, { type BudgetPreset } from "./search-filters";
import SortSelect from "./sort-select";
import { reviewCountLabel, vendorFromPrice } from "@/lib/vendor-display";
import { maskContactDetails } from "@/lib/offering-validation";

export const metadata: Metadata = {
  title: "Search vendors and services",
  description:
    "Search Kerala wedding and event vendors by service, district, date, budget and guest count. Compare prices, reviews and verified businesses on Vela.",
};

const RATING_THRESHOLDS = [4.8, 4.7, 4.5];

type Params = { [key: string]: string | string[] | undefined };

function toSearchParams(sp: Params): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => out.append(k, x));
    else if (v !== undefined) out.append(k, v);
  }
  return out;
}

/** Budget choices in the unit the results are compared in (catering: per plate). */
function budgetPresets(unit: string): BudgetPreset[] {
  const amounts: Record<string, number[]> = {
    plate: [400, 600, 900, 1200],
    person: [300, 600, 1000, 2000],
    slot: [50000, 100000, 200000, 300000],
    day: [10000, 25000, 50000, 100000],
    hour: [2000, 5000, 10000],
    item: [500, 2000, 10000],
    piece: [50, 150, 500],
    kg: [800, 1500, 2500],
    session: [10000, 20000, 40000],
  };
  const list = amounts[unit] ?? [15000, 25000, 50000, 100000, 200000];
  return list.map((n) => ({ value: n, label: `Up to ₹${n.toLocaleString("en-IN")} ${unitPhrase(unit)}` }));
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function vendorRows(ids: number[]): Promise<VendorRecord[]> {
  if (!ids.length) return [];
  const r = await pool.query<VendorRecord>("SELECT * FROM vendors WHERE id = ANY($1::int[])", [ids]);
  return r.rows;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = toSearchParams(await searchParams);
  const session = await getSession();

  const [taxonomy, favoriteIds] = await Promise.all([
    getTaxonomy(),
    session ? findFavoriteVendorIds(session.userId) : Promise.resolve(new Set<number>()),
  ]);
  const activeCategories = taxonomy.categories.filter((c) => c.active);
  // Filter values stay the stable internal name; people see the display name
  // an admin may have renamed it to (QA-008).
  const categoryLabel = categoryLabeller(taxonomy);
  const categoryOptions = activeCategories.map((c) => ({ value: c.name, label: categoryLabel(c.name) }));
  const districts = taxonomy.districts;

  // Lenient parse: a bad value in an old or edited link is ignored, not an error.
  const parsed = await parseSearchParams(sp, { strict: false, defaultPageSize: DEFAULT_PAGE_SIZE });
  const f: SearchFilters = parsed.ok ? parsed.filters : { view: "vendors", sort: "recommended", limit: DEFAULT_PAGE_SIZE };
  let page = parsed.ok ? parsed.page : 1;

  // Only categories the taxonomy knows, so the checkboxes and the results agree.
  // A link may name one by internal name, slug or current display name.
  f.categories = [
    ...new Set(
      (f.categories ?? [])
        .map((c) => resolveCategoryName({ categories: activeCategories }, c))
        .filter((c): c is string => c !== null)
    ),
  ];
  if (!f.categories?.length) f.categories = undefined;
  // "location" on this page is a district (or a town / old name in it) and
  // matches vendors based there or travelling there.
  const locationRaw = sp.get("location")?.trim();
  f.location = undefined;
  const districtId = locationRaw ? await resolveDistrict(locationRaw) : null;
  f.districtId = districtId ?? undefined;
  const district = districts.find((d) => d.id === districtId);
  // Only offered thresholds, rounding an off-list value down to one.
  f.minRating = f.minRating ? RATING_THRESHOLDS.find((t) => f.minRating! >= t) : undefined;
  if (f.offering && !taxonomy.templates.some((t) => t.code === f.offering)) f.offering = undefined;
  if (f.eventType && !taxonomy.eventTypes.some((e) => e.slug === f.eventType)) f.eventType = undefined;

  // The unit budgets are compared in: explicit, else the offering's, else the single category's.
  const template = f.offering ? taxonomy.templates.find((t) => t.code === f.offering) : undefined;
  const singleCategory = f.categories?.length === 1 ? taxonomy.categories.find((c) => c.name === f.categories![0]) : undefined;
  const budgetUnit = f.priceUnit ?? template?.default_price_unit ?? singleCategory?.default_price_unit ?? "event";
  if (f.budgetMax) f.priceUnit = budgetUnit as SearchFilters["priceUnit"];

  const pageSize = f.limit ?? DEFAULT_PAGE_SIZE;
  const run = async () => (f.view === "offerings" ? searchOfferings(f) : searchVendors(f));
  let result = await run();
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  if (page > pageCount) {
    page = pageCount;
    f.offset = (page - 1) * pageSize;
    result = await run();
  }
  const total = result.total;
  const vendors = "vendors" in result ? result.vendors : [];
  const offerings = "offerings" in result ? result.offerings : [];

  const nearby = total === 0 && f.districtId ? (await nearbyDistrictCounts(f, districts)).filter((d) => d.count > 0) : [];
  const popular =
    total === 0 && f.view === "vendors"
      ? (await searchVendors({ view: "vendors", sort: "recommended", limit: 3 })).vendors
      : [];

  const cardVendors = [...vendors, ...popular, ...(await vendorRows([...new Set(offerings.map((o) => o.vendor.id))]))];
  const cardMedia = await findCardMedia(cardVendors);

  // Builds a /search URL from the current params with overrides (null removes).
  function href(over: Record<string, string | string[] | null>) {
    const p = new URLSearchParams(sp);
    p.delete("page");
    for (const [k, v] of Object.entries(over)) {
      p.delete(k);
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else if (v !== null) p.set(k, v);
    }
    const qs = p.toString();
    return qs ? `/search?${qs}` : "/search";
  }
  const pageHref = (n: number) => {
    const p = new URLSearchParams(sp);
    if (n > 1) p.set("page", String(n));
    else p.delete("page");
    return `/search?${p.toString()}`;
  };

  const cats = f.categories ?? [];
  const eventType = taxonomy.eventTypes.find((e) => e.slug === f.eventType);
  const chips: { label: string; href: string }[] = [
    ...(f.query ? [{ label: `“${f.query}”`, href: href({ q: null }) }] : []),
    ...cats.map((c) => ({ label: categoryLabel(c), href: href({ category: cats.filter((x) => x !== c), offering: null }) })),
    ...(template ? [{ label: template.name, href: href({ offering: null }) }] : []),
    ...(district ? [{ label: f.homeOnly ? `Based in ${district.name}` : district.name, href: href({ location: null, homeOnly: null }) }] : []),
    ...(eventType ? [{ label: eventType.name, href: href({ eventType: null }) }] : []),
    ...(f.date ? [{ label: `Free on ${formatDate(f.date)}`, href: href({ date: null }) }] : []),
    ...(f.budgetMax
      ? [{ label: `Up to ₹${f.budgetMax.toLocaleString("en-IN")} ${unitPhrase(budgetUnit)}`, href: href({ budgetMax: null, priceUnit: null }) }]
      : []),
    ...(f.guests ? [{ label: `${f.guests} guests`, href: href({ guests: null }) }] : []),
    ...(f.minRating ? [{ label: `${f.minRating}+ rating`, href: href({ minRating: null }) }] : []),
    ...(f.verified ? [{ label: "Verified only", href: href({ verified: null }) }] : []),
  ];
  const clearAllHref = (() => {
    const p = new URLSearchParams();
    if (f.view === "offerings") p.set("view", "offerings");
    const s = sp.get("sort");
    if (s) p.set("sort", s);
    const qs = p.toString();
    return qs ? `/search?${qs}` : "/search";
  })();

  // Page title for screen readers and the document outline (QA-015); the
  // visible layout leads with the filters and the result count instead.
  const pageTitle = `${
    template?.name ?? (cats.length ? cats.map(categoryLabel).join(", ") : f.view === "offerings" ? "Services" : "Wedding and event vendors")
  }${district ? ` in ${district.name}` : " in Kerala"}${f.query ? ` matching “${f.query}”` : ""}`;

  const noun = f.view === "offerings" ? (total === 1 ? "service" : "services") : total === 1 ? "vendor" : "vendors";

  const renderVendor = (v: VendorRecord & { featured?: boolean }) => (
    <article
      key={v.id}
      className="relative flex flex-row gap-3.5 sm:gap-5 py-4 sm:p-4 sm:-mx-4 border-b border-line sm:border-b-0 sm:rounded-card sm:hover:bg-surface-muted transition-colors group has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent"
    >
      <CardImage
        src={cardMedia.get(v.id)?.src ?? null}
        color={cardMedia.get(v.id)?.color ?? null}
        hasVideo={cardMedia.get(v.id)?.hasVideo ?? false}
        category={v.category}
        className="w-[88px] h-[88px] sm:w-[200px] sm:h-[140px]"
      />
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
          {categoryLabel(v.category)} · {v.location} · {v.experience} experience
        </div>
        <Badges verified={!!v.verified_at} featured={!!v.featured} demo={!!v.is_demo} />
        <Rating rating={v.rating} count={v.reviews_count} />
        {v.tags.length > 0 && (
          <div className="hidden sm:flex gap-1.5 flex-wrap mt-2.5">
            {v.tags.map((raw, i) => {
              // Specialities are vendor-typed: mask phones, emails and links (QA-043).
              const t = maskContactDetails(raw).text;
              return (
                <span key={`${i}-${t}`} className="chip">
                  {t}
                </span>
              );
            })}
          </div>
        )}
        <div className="text-sm sm:text-[15px] font-semibold text-accent mt-1.5 sm:mt-auto sm:pt-2.5">
          {vendorFromPrice(v) ?? "Price on request"}
        </div>
      </div>
    </article>
  );

  const renderOffering = (o: SearchOffering) => {
    const media = cardMedia.get(o.vendor.id);
    const place = o.vendor.district && o.vendor.district !== o.vendor.location ? `${o.vendor.location}, ${o.vendor.district}` : o.vendor.location;
    return (
      <article
        key={o.id}
        aria-label={`${o.title} · ${o.priceLabel} · by ${o.vendor.name}, ${o.vendor.location}`}
        className="relative flex flex-row gap-3.5 sm:gap-5 py-4 sm:p-4 sm:-mx-4 border-b border-line sm:border-b-0 sm:rounded-card sm:hover:bg-surface-muted transition-colors group has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent"
      >
        <CardImage
          src={media?.src ?? null}
          color={media?.color ?? null}
          hasVideo={media?.hasVideo ?? false}
          category={o.category}
          className="w-[88px] h-[88px] sm:w-[160px] sm:h-[112px]"
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-[16px] sm:text-[17px] leading-snug font-semibold tracking-[-0.01em] pt-0.5 group-hover:text-accent">
              <Link
                href={`/vendors/${o.vendor.id}#offering-${o.id}`}
                className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none"
              >
                {o.title}
              </Link>
            </h2>
            <div className="relative z-10 shrink-0">
              <FavoriteButton vendorId={o.vendor.id} initialFavorited={favoriteIds.has(o.vendor.id)} loggedIn={!!session} size="sm" />
            </div>
          </div>
          <div className="text-[13px] sm:text-sm text-ink-soft mt-0.5">
            {o.categoryDisplay}
            {o.kind === "package" ? " · Package" : ""}
          </div>
          <div className="text-sm sm:text-[15px] font-semibold text-accent mt-1.5">{o.priceLabel}</div>
          <div className="text-[13px] sm:text-sm text-ink-soft mt-1 line-clamp-2">
            by <span className="font-medium text-foreground">{o.vendor.name}</span>, {place}
          </div>
          <Badges verified={o.vendor.verified} featured={o.vendor.featured} />
          <Rating rating={o.vendor.rating} count={o.vendor.reviewsCount} />
        </div>
      </article>
    );
  };

  const templatesForFilter =
    cats.length > 0
      ? taxonomy.templates
          .filter((t) => t.kind === "unit" && cats.includes(taxonomy.categories.find((c) => c.id === t.category_id)?.name ?? ""))
          .map((t) => ({ code: t.code, name: t.name }))
      : [];

  return (
    <main className="page w-full pt-4 pb-10 md:pt-8 md:pb-16 flex flex-col md:flex-row md:items-start gap-x-10">
      <h1 className="sr-only">{pageTitle}</h1>
      <SearchFilterPanel
        categories={categoryOptions}
        districts={districts.map((d) => d.name)}
        eventTypes={taxonomy.eventTypes.filter((e) => e.slug !== "other").map((e) => ({ slug: e.slug, name: e.name }))}
        templates={templatesForFilter}
        active={{
          categories: cats,
          location: district?.name ?? "",
          homeOnly: !!f.homeOnly,
          minRating: f.minRating ? String(f.minRating) : "0",
          offering: f.offering ?? "",
          eventType: f.eventType ?? "",
          date: f.date ?? "",
          budgetMax: f.budgetMax ? String(f.budgetMax) : "",
          guests: f.guests ? String(f.guests) : "",
          verified: !!f.verified,
        }}
        budgetUnit={budgetUnit}
        budgetPresets={budgetPresets(budgetUnit)}
        today={todayInIndia()}
        resultLabel={`${total} ${noun}`}
        mobileToolbar={<SortSelect value={f.sort} />}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 mb-3 md:mb-4 min-h-6 md:min-h-10 flex-wrap">
          <nav aria-label="Show results as" className="inline-flex rounded-full border border-line-strong bg-surface p-1">
            {(["vendors", "offerings"] as const).map((v) => {
              const current = f.view === v;
              return (
                <Link
                  key={v}
                  href={href({ view: v === "vendors" ? null : "offerings", sort: f.sort === "recommended" ? null : sp.get("sort") })}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex items-center min-h-11 sm:min-h-9 px-4 rounded-full text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    current ? "bg-accent text-white" : "text-ink-soft hover:text-foreground hover:bg-surface-muted"
                  }`}
                >
                  {v === "vendors" ? "Vendors" : "Services"}
                </Link>
              );
            })}
          </nav>
          <div className="hidden md:block">
            <SortSelect value={f.sort} />
          </div>
        </div>

        <p className="text-sm md:text-[15px] text-ink-soft mb-2" aria-live="polite">
          <span className="font-semibold text-foreground">{total}</span> {noun}
          {f.query ? <> for &ldquo;<span className="text-foreground">{f.query}</span>&rdquo;</> : " found"}
        </p>

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
                <Link href={clearAllHref} className="inline-flex items-center min-h-11 sm:min-h-9 text-[13px] font-medium text-accent px-2 rounded-full hover:underline">
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
              <p className="text-base sm:text-lg font-semibold text-foreground">
                No {f.view === "offerings" ? "services" : "vendors"} match {chips.length > 0 ? "these filters" : "yet"}
                {district ? ` in ${district.name}` : ""}.
              </p>
              {nearby.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm">Try a nearby district:</p>
                  <ul className="mt-3 flex flex-wrap justify-center gap-2" aria-label="Nearby districts">
                    {nearby.map((d) => (
                      <li key={d.id}>
                        <Link href={href({ location: d.name })} className="btn btn-secondary btn-sm">
                          {d.name} <span className="text-ink-soft tabular-nums">({d.count})</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {chips.length > 0 && (
                <p className="mt-4 text-sm max-w-[42ch] mx-auto">
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
                <div>{popular.map(renderVendor)}</div>
              </div>
            )}
          </div>
        ) : f.view === "offerings" ? (
          <div>{offerings.map(renderOffering)}</div>
        ) : (
          <div>{vendors.map(renderVendor)}</div>
        )}

        {pageCount > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 mt-8 text-sm">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="btn btn-secondary">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-soft">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={pageHref(page + 1)} className="btn btn-secondary">
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

function Rating({ rating, count }: { rating: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[13px] sm:text-sm mt-1.5">
      {count > 0 ? (
        <>
          <span className="text-gold" aria-hidden="true">★</span>
          <span className="font-medium text-foreground">{rating}</span>
          <span className="text-ink-soft">({reviewCountLabel(count)})</span>
        </>
      ) : (
        <span className="text-ink-soft">New on Vela · no reviews yet</span>
      )}
    </div>
  );
}

function Badges({ verified, featured, demo = false }: { verified: boolean; featured: boolean; demo?: boolean }) {
  if (!verified && !featured && !demo) return null;
  return (
    <div className="flex gap-1.5 flex-wrap mt-1.5">
      {demo && <span className="chip">Demo listing</span>}
      {featured && <span className="chip bg-[#fbf3dc] text-gold-ink">Featured</span>}
      {verified && (
        <span className="chip bg-accent-tint text-accent-hover">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Verified business
        </span>
      )}
    </div>
  );
}
