import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTaxonomy } from "@/lib/taxonomy";
import { categoryDistrictCounts, topVendorsByCategory } from "@/lib/search";
import type { VendorRecord } from "@/lib/db";
import { findCardMedia } from "@/app/search/card-media";
import VendorMiniCard from "@/app/_browse/vendor-mini-card";

// Category landing page (P2-8): what the category covers (offering
// templates), top vendors, districts and the occasions that need it.

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) return null;
  const taxonomy = await getTaxonomy();
  const category = taxonomy.categories.find((c) => c.slug === slug && c.active);
  if (!category) return null;
  const templates = taxonomy.templates.filter((t) => t.category_id === category.id && t.kind === "unit" && t.active);
  const occasions = taxonomy.eventTypes.filter((e) => e.categories.some((c) => c.category_id === category.id));
  return { category, templates, occasions };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: "Category not found", robots: { index: false } };
  const { category, templates } = data;
  const examples = templates.slice(0, 3).map((t) => t.name);
  return {
    title: `${category.display_name} in Kerala: prices and reviews`,
    description:
      `Compare ${category.display_name.toLowerCase()} vendors across Kerala` +
      (examples.length ? `, from ${examples.join(", ")}` : "") +
      ". See starting prices, reviews and verified businesses, and request free quotes on Vela.",
    alternates: { canonical: `/c/${category.slug}` },
  };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { category, templates, occasions } = data;

  const [top, districts] = await Promise.all([topVendorsByCategory([category.id], 6), categoryDistrictCounts(category.id)]);
  const t = top.get(category.id);
  const vendors = t?.vendors ?? [];
  const total = t?.total ?? 0;
  const media = await findCardMedia(vendors as unknown as VendorRecord[]);
  const name = encodeURIComponent(category.name);

  return (
    <main className="page w-full pt-4 pb-12 md:pt-8 md:pb-16">
      <nav aria-label="Breadcrumb" className="text-[13px] text-ink-soft mb-4">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="inline-flex items-center min-h-11 px-1 -mx-1 hover:text-accent hover:underline">Home</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">{category.display_name}</li>
        </ol>
      </nav>

      <header className="max-w-[720px]">
        <p className="eyebrow mb-2">Category</p>
        <h1 className="text-[28px] sm:text-[36px] leading-tight font-semibold tracking-[-0.02em]">
          {category.display_name} in Kerala
        </h1>
        <p className="text-ink-soft mt-3 text-[16px] leading-relaxed">
          {category.description ||
            `${total} ${category.display_name.toLowerCase()} vendor${total === 1 ? "" : "s"} on Vela. Compare starting prices, reviews and what each one includes, then request quotes for free.`}
        </p>
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <Link href={`/search?category=${name}`} className="btn btn-primary">
            {total > 0 ? `See all ${total} vendor${total === 1 ? "" : "s"}` : "Browse vendors"}
          </Link>
          <Link href={`/search?view=offerings&category=${name}`} className="btn btn-secondary">
            Compare services and prices
          </Link>
        </div>
      </header>

      {templates.length > 0 && (
        <section aria-labelledby="services" className="mt-10">
          <h2 id="services" className="text-title sm:text-heading font-semibold mb-4">
            Popular services
          </h2>
          <ul className="flex flex-wrap gap-2">
            {templates.map((tp) => (
              <li key={tp.code}>
                <Link
                  href={`/search?view=offerings&category=${name}&offering=${encodeURIComponent(tp.code)}`}
                  className="inline-flex items-center min-h-11 px-4 rounded-full border border-line bg-surface text-sm hover:bg-accent-tint hover:text-accent hover:border-accent/30 transition-colors"
                >
                  {tp.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="top" className="mt-10">
        <h2 id="top" className="text-title sm:text-heading font-semibold mb-4">
          Top {category.display_name.toLowerCase()} vendors
        </h2>
        {vendors.length > 0 ? (
          // grid-cols-1 (minmax(0,1fr)) + min-w-0 on the items: a long vendor
          // name truncates instead of widening the page on a phone (QA-061).
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((v) => (
              <li key={v.id} className="min-w-0">
                <VendorMiniCard v={v} media={media.get(v.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-card bg-surface-muted px-5 py-10 text-center text-ink-soft">
            <p className="text-base font-semibold text-foreground">No {category.display_name.toLowerCase()} vendors yet.</p>
            <p className="mt-2 text-sm">
              Are you one?{" "}
              <Link href="/for-vendors" className="text-accent font-medium underline underline-offset-2">
                List your business for free
              </Link>
              .
            </p>
          </div>
        )}
      </section>

      {districts.length > 0 && (
        <nav aria-labelledby="by-district" className="mt-10">
          <h2 id="by-district" className="text-title sm:text-heading font-semibold mb-4">
            By district
          </h2>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {districts.map((d) => (
              <li key={d.name}>
                <Link
                  href={`/search?category=${name}&location=${encodeURIComponent(d.name)}`}
                  className="inline-flex items-center gap-1 min-h-11 text-sm text-foreground underline-offset-4 hover:text-accent hover:underline"
                >
                  {d.name} <span className="text-ink-soft tabular-nums">({d.count})</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {occasions.length > 0 && (
        <nav aria-labelledby="occasions" className="mt-12 border-t border-line pt-8">
          <h2 id="occasions" className="eyebrow mb-3">
            Often booked for
          </h2>
          <ul className="flex flex-wrap gap-2">
            {occasions.map((e) => (
              <li key={e.slug}>
                <Link
                  href={`/e/${e.slug}`}
                  className="inline-flex items-center min-h-11 px-4 rounded-full border border-line bg-surface text-sm hover:bg-accent-tint hover:text-accent hover:border-accent/30 transition-colors"
                >
                  {e.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </main>
  );
}
