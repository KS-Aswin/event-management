import type { Metadata } from "next";
import Link from "next/link";
import { findVendors, type VendorRecord } from "@/lib/db";
import type { Taxonomy } from "@/lib/db";
import { getTaxonomy } from "@/lib/taxonomy";
import { VendorTile } from "@/lib/vendorVisuals";
import HomeSearch from "./home-search";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: { absolute: "Vela: Wedding & event vendors in Kerala" },
  description:
    "Find and compare wedding and event vendors across Kerala: venues, photographers, caterers, decorators, makeup and mehendi artists.",
};

// Reads live vendor data on every request.
export const dynamic = "force-dynamic";

async function loadTaxonomy(): Promise<Taxonomy | null> {
  try {
    return await getTaxonomy();
  } catch {
    return null;
  }
}

async function loadVendors(): Promise<VendorRecord[]> {
  try {
    const vendors = await findVendors({ sort: "rating" });
    return vendors.filter((v) => !v.status || v.status === "approved");
  } catch {
    // Keep the home page usable even if the database is unavailable.
    return [];
  }
}

function countBy(keys: string[]) {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return counts;
}

export default async function Home() {
  const [vendors, taxonomy, session] = await Promise.all([loadVendors(), loadTaxonomy(), getSession()]);
  const taxonomyNames = taxonomy?.categories.filter((c) => c.active).map((c) => c.name) ?? [];
  const districtNames = taxonomy?.districts.map((d) => d.name) ?? [];
  const eventTypes = taxonomy?.eventTypes.filter((e) => e.slug !== "other") ?? [];
  const categoryCounts = countBy(vendors.map((v) => v.category));
  // Home district (the town falls back when a vendor has no district yet).
  const districtById = new Map(taxonomy?.districts.map((d) => [d.id, d.name]) ?? []);
  const districtCounts = countBy(vendors.map((v) => (v.district_id && districtById.get(v.district_id)) || v.location));

  // DB taxonomy categories first (admin sort order), then any others found in
  // the data. Categories with no live vendor yet are hidden so the chips never
  // lead to an empty search.
  const known: readonly string[] = taxonomyNames;
  const categories = [
    ...taxonomyNames
      .map((c) => ({ name: c, count: categoryCounts.get(c) ?? 0 }))
      .filter((c) => c.count > 0),
    ...[...categoryCounts.entries()]
      .filter(([c]) => !known.includes(c))
      .map(([name, count]) => ({ name, count })),
  ];
  const districts = [...districtCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topRated = vendors.slice(0, 6);

  return (
    <main className="flex-1 flex flex-col items-center w-full">
      <section className="w-full flex flex-col items-center justify-start pt-10 pb-8 sm:justify-center sm:pt-16 sm:pb-12 px-4 sm:px-7 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,var(--color-accent-tint),transparent_70%)]">
        <div className="font-display text-[56px] sm:text-[80px] font-semibold text-accent leading-none mb-3 tracking-tight" aria-hidden="true">
          Vel<span className="text-gold">a</span>
        </div>
        <h1 className="text-ink-soft mb-7 sm:mb-9 text-center text-[17px] sm:text-xl leading-snug max-w-[34ch] sm:max-w-[560px]">
          <span className="sr-only">Vela: </span>
          Find and compare wedding &amp; event vendors across Kerala
        </h1>

        <HomeSearch districts={districtNames} />

        {eventTypes.length > 0 && (
          <nav aria-label="Plan by occasion" className="w-full max-w-[720px] mt-9 sm:mt-11">
            <h2 className="eyebrow text-center mb-3">Plan by occasion</h2>
            <ul className="flex gap-2 flex-nowrap overflow-x-auto overscroll-x-contain snap-x scroll-px-4 -mx-4 px-4 pb-1 [scrollbar-width:none] [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] sm:[mask-image:none] sm:mx-0 sm:px-0 sm:pb-0 sm:flex-wrap sm:justify-center sm:overflow-visible">
              {eventTypes.map((e) => (
                <li key={e.slug} className="shrink-0 snap-start">
                  <Link
                    href={`/e/${e.slug}`}
                    className="inline-flex items-center min-h-11 border border-accent/25 bg-accent-tint text-accent-hover rounded-full px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-white whitespace-nowrap"
                  >
                    {e.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <nav aria-label="Browse by category" className="w-full max-w-[720px] mt-6 sm:mt-7">
          <h2 className="eyebrow text-center mb-3">Browse by category</h2>
          <ul className="flex gap-2 flex-nowrap overflow-x-auto overscroll-x-contain snap-x scroll-px-4 -mx-4 px-4 pb-1 [scrollbar-width:none] [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] sm:[mask-image:none] sm:mx-0 sm:px-0 sm:pb-0 sm:flex-wrap sm:justify-center sm:overflow-visible">
            {categories.map((c) => (
              <li key={c.name} className="shrink-0 snap-start">
                <Link
                  href={`/search?category=${encodeURIComponent(c.name)}`}
                  className="group inline-flex items-center min-h-11 gap-2 border border-line bg-white rounded-full pl-4 pr-2 text-sm text-foreground transition-colors hover:bg-accent-tint hover:text-accent hover:border-accent/30 whitespace-nowrap"
                >
                  {c.name}
                  <span className="min-w-6 h-6 px-1.5 inline-flex items-center justify-center rounded-full bg-surface-muted text-xs text-ink-soft tabular-nums group-hover:bg-white group-hover:text-accent">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {districts.length > 0 && (
          <nav aria-label="Browse by district" className="w-full max-w-[720px] mt-3 text-sm text-ink-soft">
            <ul className="flex gap-x-4 flex-nowrap overflow-x-auto overscroll-x-contain -mx-4 px-4 [scrollbar-width:none] [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] sm:[mask-image:none] sm:mx-0 sm:px-0 sm:flex-wrap sm:justify-center sm:overflow-visible">
              <li className="shrink-0 inline-flex items-center min-h-11 eyebrow">Districts</li>
              {districts.map(([name, count]) => (
                <li key={name} className="shrink-0">
                  <Link href={`/search?location=${encodeURIComponent(name)}`} className="inline-flex items-center gap-1 min-h-11 text-foreground underline-offset-4 hover:text-accent hover:underline whitespace-nowrap">
                    {name} <span className="text-ink-soft tabular-nums">({count})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>

      {topRated.length > 0 && (
        <section aria-labelledby="top-rated" className="page py-10 sm:py-14 border-t border-line">
          <div className="flex items-center justify-between gap-4 mb-5 sm:mb-6">
            <h2 id="top-rated" className="text-title sm:text-heading font-semibold">
              Top-rated vendors
            </h2>
            <Link href="/search" className="btn btn-ghost btn-sm -mr-2 whitespace-nowrap">
              See all {vendors.length} vendors
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
          <ul className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topRated.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/vendors/${v.id}`}
                  className="card card-link flex gap-4 items-center p-3 sm:p-3.5 group h-full"
                >
                  <VendorTile category={v.category} size={28} className="w-16 h-16 rounded-control shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold truncate group-hover:text-accent">{v.name}</div>
                    <div className="text-[13px] text-ink-soft truncate mt-0.5">
                      {v.category} · {v.location}
                    </div>
                    <div className="text-[13px] mt-1 tabular-nums">
                      <span className="text-gold" aria-hidden="true">★</span> <span className="font-semibold">{v.rating}</span>{" "}
                      <span className="text-ink-soft">({v.reviews_count} reviews)</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="how-it-works" className="page pt-2 pb-10 sm:pb-14">
        <h2 id="how-it-works" className="text-title sm:text-heading font-semibold mb-5 sm:mb-6">
          How Vela works
        </h2>
        <ol className="grid gap-3 sm:gap-4 sm:grid-cols-3">
          {[
            ["Search", "Look up vendors by category, district or name across Kerala."],
            ["Compare", "Check ratings, reviews, experience and starting prices side by side."],
            ["Request a quote", "Send your event details to the vendors you like and hear back directly."],
          ].map(([title, body], i) => (
            <li key={title} className="rounded-card bg-surface-muted p-5 flex gap-4 sm:flex-col sm:gap-3">
              <div className="w-9 h-9 shrink-0 rounded-full bg-white border border-line text-accent font-semibold flex items-center justify-center tabular-nums">
                {i + 1}
              </div>
              <div>
                <div className="font-semibold text-title mb-1">{title}</div>
                <p className="text-sm text-ink-soft max-w-[40ch]">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="free-for-families" className="page pb-12 sm:pb-16">
        <div className="bg-accent-tint rounded-card p-5 sm:px-8 sm:py-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-8">
          <div>
            <h2 id="free-for-families" className="text-title font-semibold text-accent">
              Free for families
            </h2>
            <p className="text-sm text-ink-soft mt-1">
              Searching, comparing and requesting quotes costs you nothing.
            </p>
          </div>
          {/* Signed-in customers never see vendor calls to action (P2-1). */}
          {session?.role === "customer" ? (
            <Link href="/my" className="btn btn-secondary w-full sm:w-auto whitespace-nowrap">
              Go to my events
            </Link>
          ) : (
            <Link href="/for-vendors" className="btn btn-secondary w-full sm:w-auto whitespace-nowrap">
              Are you a vendor? List your business
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
