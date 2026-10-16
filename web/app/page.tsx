import Link from "next/link";
import { findFeaturedVendors } from "@/lib/db";
import { VendorTile } from "@/lib/vendorVisuals";
import HomeSearch from "./home-search";

export default async function Home() {
  const featured = await findFeaturedVendors(4);

  return (
    <main className="flex-1 flex flex-col">
      <HomeSearch />

      {featured.length > 0 && (
        <section className="max-w-[1000px] w-full mx-auto px-6 pb-16">
          <div className="flex items-baseline justify-between mb-3.5">
            <h2 className="text-lg font-semibold">Featured vendors</h2>
            <Link href="/search?sort=trending" className="text-sm text-accent hover:underline">
              See trending →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {featured.map((v) => (
              <Link
                key={v.id}
                href={`/vendors/${v.id}`}
                className="border border-line rounded-xl overflow-hidden hover:border-accent hover:shadow-sm transition"
              >
                <VendorTile category={v.category} size={34} className="w-full h-[96px]" />
                <div className="p-3">
                  <div className="text-sm font-semibold truncate">{v.name}</div>
                  <div className="text-xs text-ink-soft mt-0.5">
                    {v.category} · {v.location}
                  </div>
                  <div className="text-xs mt-1.5">
                    <span className="text-gold">★</span> {v.rating} · {v.price_label}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
