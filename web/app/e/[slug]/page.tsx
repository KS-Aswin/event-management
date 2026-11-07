import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTaxonomy } from "@/lib/taxonomy";
import { topVendorsByCategory, type BrowseVendor } from "@/lib/search";
import type { VendorRecord } from "@/lib/db";
import { findCardMedia } from "@/app/search/card-media";
import VendorMiniCard from "@/app/_browse/vendor-mini-card";

// Event-type browse (P2-8): the bundle of categories an occasion usually
// needs (event_type_categories) with the top vendors in each.

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) return null;
  const taxonomy = await getTaxonomy();
  const eventType = taxonomy.eventTypes.find((e) => e.slug === slug);
  if (!eventType) return null;
  const bundle = eventType.categories
    .map((b) => ({ ...b, category: taxonomy.categories.find((c) => c.id === b.category_id) }))
    .filter((b): b is typeof b & { category: NonNullable<typeof b.category> } => !!b.category && b.category.active);
  return { taxonomy, eventType, bundle };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: "Occasion not found", robots: { index: false } };
  const { eventType, bundle } = data;
  const names = bundle.filter((b) => b.is_core).map((b) => b.category.display_name.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "vendors";
  return {
    title: `${eventType.name} vendors in Kerala`,
    description: `Plan your ${eventType.name} in Kerala: compare ${list}, with prices, reviews and free quotes on Vela.`,
    alternates: { canonical: `/e/${eventType.slug}` },
  };
}

export default async function EventTypePage({ params }: Props) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { taxonomy, eventType, bundle } = data;

  const top = await topVendorsByCategory(bundle.map((b) => b.category_id), 3);
  const allVendors: BrowseVendor[] = [...top.values()].flatMap((t) => t.vendors);
  const media = await findCardMedia(allVendors as unknown as VendorRecord[]);
  const core = bundle.filter((b) => b.is_core);
  const extra = bundle.filter((b) => !b.is_core);
  const others = taxonomy.eventTypes.filter((e) => e.slug !== eventType.slug && e.slug !== "other");

  const section = (items: typeof bundle) => (
    // grid-cols-1 (minmax(0,1fr)) + min-w-0: a card never grows past the
    // screen for a long vendor name; the name truncates instead (QA-011).
    <ul className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((b) => {
        const t = top.get(b.category_id);
        const searchHref = `/search?category=${encodeURIComponent(b.category.name)}&eventType=${encodeURIComponent(eventType.slug)}`;
        return (
          <li key={b.category_id} className="card flex flex-col min-w-0 p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 break-words text-title font-semibold">
                <Link href={`/c/${b.category.slug}`} className="inline-flex items-center min-h-11 hover:text-accent hover:underline underline-offset-4">
                  {b.category.display_name}
                </Link>
              </h3>
              <span className="text-[13px] text-ink-soft tabular-nums whitespace-nowrap">
                {t?.total ?? 0} vendor{t?.total === 1 ? "" : "s"}
              </span>
            </div>
            {t && t.vendors.length > 0 ? (
              <div className="mt-3 flex flex-col gap-1 min-w-0">
                {t.vendors.map((v) => (
                  <VendorMiniCard key={v.id} v={v} media={media.get(v.id)} />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">No vendors listed in this category yet.</p>
            )}
            <div className="mt-auto pt-3">
              {t && t.total > 0 ? (
                <Link href={searchHref} className="btn btn-ghost btn-sm -ml-3.5">
                  See all {b.category.display_name.toLowerCase()}
                  <span aria-hidden="true">&rarr;</span>
                </Link>
              ) : (
                <Link href="/search" className="btn btn-ghost btn-sm -ml-3.5">
                  Browse all vendors
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <main className="page w-full pt-4 pb-12 md:pt-8 md:pb-16">
      <nav aria-label="Breadcrumb" className="text-[13px] text-ink-soft mb-4">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="inline-flex items-center min-h-11 px-1 -mx-1 hover:text-accent hover:underline">Home</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">{eventType.name}</li>
        </ol>
      </nav>

      <header className="max-w-[720px]">
        <p className="eyebrow mb-2">Plan by occasion</p>
        <h1 className="text-[28px] sm:text-[36px] leading-tight font-semibold tracking-[-0.02em]">
          {eventType.name} vendors in Kerala
        </h1>
        <p className="text-ink-soft mt-3 text-[16px] leading-relaxed">
          What your {eventType.name} usually needs, with the top-rated vendors for each. Open a category to
          compare prices and reviews, then request quotes for free.
        </p>
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <Link href={`/search?eventType=${encodeURIComponent(eventType.slug)}`} className="btn btn-primary">
            Search all {eventType.name} vendors
          </Link>
          <Link href={`/search?view=offerings&eventType=${encodeURIComponent(eventType.slug)}`} className="btn btn-secondary">
            Compare services and prices
          </Link>
        </div>
      </header>

      {bundle.length === 0 ? (
        <div className="mt-10 rounded-card bg-surface-muted px-5 py-10 text-center text-ink-soft">
          <p className="text-base font-semibold text-foreground">Every occasion is different.</p>
          <p className="mt-2 text-sm">
            <Link href="/search" className="text-accent font-medium underline underline-offset-2">Browse all vendors</Link> to
            find what you need.
          </p>
        </div>
      ) : (
        <>
          {core.length > 0 && (
            <section aria-labelledby="need" className="mt-10">
              <h2 id="need" className="text-title sm:text-heading font-semibold mb-4">
                What you&apos;ll need
              </h2>
              {section(core)}
            </section>
          )}
          {extra.length > 0 && (
            <section aria-labelledby="extra" className="mt-10">
              <h2 id="extra" className="text-title sm:text-heading font-semibold mb-4">
                Also worth considering
              </h2>
              {section(extra)}
            </section>
          )}
        </>
      )}

      {others.length > 0 && (
        <nav aria-label="Other occasions" className="mt-12 border-t border-line pt-8">
          <h2 className="eyebrow mb-3">Other occasions</h2>
          <ul className="flex flex-wrap gap-2">
            {others.map((e) => (
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
