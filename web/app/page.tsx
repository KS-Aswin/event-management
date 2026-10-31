import type { Metadata } from "next";
import Link from "next/link";
import { findVendors, type VendorRecord } from "@/lib/db";
import { CATEGORIES, VendorTile } from "@/lib/vendorVisuals";
import HomeSearch from "./home-search";

export const metadata: Metadata = {
  title: { absolute: "Vela: Wedding & event vendors in Kerala" },
  description:
    "Find and compare wedding and event vendors across Kerala: venues, photographers, caterers, decorators, makeup and mehendi artists.",
};

// Reads live vendor data on every request.
export const dynamic = "force-dynamic";

async function loadVendors(): Promise<VendorRecord[]> {
  try {
    const vendors = await findVendors({ sort: "rating" });
    return vendors.filter((v) => !v.status || v.status === "approved");
  } catch {
    // Keep the home page usable even if the database is unavailable.
    return [];
  }
}

function countBy(vendors: VendorRecord[], key: "category" | "location") {
  const counts = new Map<string, number>();
  for (const v of vendors) counts.set(v[key], (counts.get(v[key]) ?? 0) + 1);
  return counts;
}

export default async function Home() {
  const vendors = await loadVendors();
  const categoryCounts = countBy(vendors, "category");
  const districtCounts = countBy(vendors, "location");

  // Known categories first (stable order), then any others found in the data.
  const known: readonly string[] = CATEGORIES;
  const categories = [
    ...CATEGORIES.map((c) => ({ name: c as string, count: categoryCounts.get(c) ?? 0 })),
    ...[...categoryCounts.entries()]
      .filter(([c]) => !known.includes(c))
      .map(([name, count]) => ({ name, count })),
  ];
  const districts = [...districtCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topRated = vendors.slice(0, 6);

  return (
    <main className="flex-1 flex flex-col items-center w-full">
      <section className="w-full flex flex-col items-center justify-start pt-10 pb-10 sm:justify-center sm:py-14 px-5">
        <div className="font-display text-5xl sm:text-[72px] font-semibold text-accent leading-none mb-2" aria-hidden="true">
          Vel<span className="text-gold">a</span>
        </div>
        <h1 className="text-ink-soft mb-8 text-center text-base sm:text-lg max-w-[520px]">
          <span className="sr-only">Vela: </span>
          Find and compare wedding &amp; event vendors across Kerala
        </h1>

        <HomeSearch />

        <nav aria-label="Browse by category" className="w-full max-w-[660px] mt-10">
          <ul className="flex gap-2.5 flex-nowrap overflow-x-auto -mx-5 px-5 pb-1 sm:mx-0 sm:px-0 sm:pb-0 sm:flex-wrap sm:justify-center sm:overflow-visible">
            {categories.map((c) => (
              <li key={c.name} className="shrink-0">
                <Link
                  href={`/search?category=${encodeURIComponent(c.name)}`}
                  className="inline-flex items-center min-h-10 gap-1.5 border border-line rounded-full px-4 py-2 text-[13px] text-ink-soft hover:bg-accent-tint hover:text-accent hover:border-accent-tint whitespace-nowrap"
                >
                  {c.name}
                  <span className="text-[11.5px] opacity-75">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {districts.length > 0 && (
          <nav aria-label="Browse by district" className="w-full max-w-[660px] mt-4 text-[13px] text-ink-soft">
            <ul className="flex gap-x-3 gap-y-1.5 flex-nowrap overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0 sm:flex-wrap sm:justify-center sm:overflow-visible">
              <li className="shrink-0 inline-flex items-center min-h-10">Districts:</li>
              {districts.map(([name, count]) => (
                <li key={name} className="shrink-0">
                  <Link href={`/search?location=${encodeURIComponent(name)}`} className="inline-flex items-center min-h-10 hover:text-accent hover:underline whitespace-nowrap">
                    {name} <span className="opacity-75">({count})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>

      {topRated.length > 0 && (
        <section aria-labelledby="top-rated" className="w-full max-w-[1180px] px-5 sm:px-6 py-10 border-t border-line">
          <div className="flex items-baseline justify-between gap-4 mb-5">
            <h2 id="top-rated" className="text-xl font-semibold">
              Top-rated vendors
            </h2>
            <Link href="/search" className="inline-flex items-center min-h-10 text-sm text-accent hover:underline whitespace-nowrap">
              See all {vendors.length} vendors
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topRated.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/vendors/${v.id}`}
                  className="flex gap-3.5 items-center border border-line rounded-xl p-3 hover:border-accent group h-full"
                >
                  <VendorTile category={v.category} size={28} className="w-16 h-16 rounded-lg" />
                  <div className="min-w-0">
                    <div className="font-semibold truncate group-hover:text-accent">{v.name}</div>
                    <div className="text-[13px] text-ink-soft truncate">
                      {v.category} · {v.location}
                    </div>
                    <div className="text-[13px] mt-0.5">
                      <span className="text-gold" aria-hidden="true">★</span> {v.rating}{" "}
                      <span className="text-ink-soft">({v.reviews_count} reviews)</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="how-it-works" className="w-full max-w-[1180px] px-5 sm:px-6 py-10 border-t border-line">
        <h2 id="how-it-works" className="text-xl font-semibold mb-5">
          How Vela works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            ["Search", "Look up vendors by category, district or name across Kerala."],
            ["Compare", "Check ratings, reviews, experience and starting prices side by side."],
            ["Request a quote", "Send your event details to the vendors you like and hear back directly."],
          ].map(([title, body], i) => (
            <li key={title} className="border border-line rounded-xl p-4">
              <div className="w-7 h-7 rounded-full bg-accent-tint text-accent text-sm font-semibold flex items-center justify-center mb-2.5">
                {i + 1}
              </div>
              <div className="font-semibold mb-1">{title}</div>
              <p className="text-sm text-ink-soft">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="free-for-families" className="w-full max-w-[1180px] px-5 sm:px-6 pb-14">
        <div className="bg-accent-tint rounded-xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 id="free-for-families" className="text-lg font-semibold text-accent">
              Free for families
            </h2>
            <p className="text-sm text-ink-soft mt-1">
              Searching, comparing and requesting quotes costs you nothing.
            </p>
          </div>
          <Link href="/for-vendors" className="inline-flex items-center min-h-10 text-sm text-accent hover:underline whitespace-nowrap">
            Are you a vendor? List your business
          </Link>
        </div>
      </section>
    </main>
  );
}
