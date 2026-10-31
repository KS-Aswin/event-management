import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findVendorCategoryIds, findVendorServiceAreas, getOwnVendor } from "@/lib/db";
import { getTaxonomy } from "@/lib/taxonomy";
import { toProfile } from "@/app/api/vendor/profile/shape";
import { travelLabel } from "@/app/api/vendor/profile/validate";
import ProfileForm from "./profile-form";

export const metadata: Metadata = { title: "Profile & business" };

// Business profile (PRODUCT_PLAN 2.4 /vendor/profile, P0-13). Every section
// saves on its own through PATCH /api/vendor/profile.
export default async function VendorProfilePage() {
  const { session } = await requirePageRole("vendor");
  const vendor = await getOwnVendor(session.userId);
  if (!vendor) redirect("/vendor/onboarding");

  const [taxonomy, additional, areas] = await Promise.all([
    getTaxonomy(),
    findVendorCategoryIds(vendor.id),
    findVendorServiceAreas(vendor.id),
  ]);
  const categories = taxonomy.categories
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, name: c.display_name || c.name }));
  const districts = taxonomy.districts.map((d) => ({ id: d.id, name: d.name }));
  const home = districts.find((d) => d.id === vendor.district_id)?.name ?? null;

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Profile &amp; business</h1>
          <p className="text-ink-soft text-lead mt-1">What customers see about your business, and how they reach you.</p>
        </div>
        <Link href={`/vendors/${vendor.id}?preview=1`} className="btn btn-secondary btn-sm">
          Preview public profile
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <ProfileForm initial={toProfile(vendor, additional)} categories={categories} districts={districts} />

        <aside className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--header-h)+16px)]">
          <section className="card" aria-labelledby="areas-summary-h">
            <h2 id="areas-summary-h" className="text-title font-semibold">
              Where you work
            </h2>
            <p className="text-body text-ink-soft mt-1">
              {home ? <>Home district: <span className="text-foreground font-medium">{home}</span>.</> : "Set your home district in Location."}{" "}
              {areas.length === 0
                ? "You haven't added other districts yet."
                : `You also travel to ${areas.length} district${areas.length === 1 ? "" : "s"}.`}
            </p>
            {areas.length > 0 && (
              <ul className="mt-2 text-caption">
                {areas.slice(0, 6).map((a) => (
                  <li key={a.district_id} className="flex justify-between gap-2 py-1 border-b border-line last:border-b-0">
                    <span>{a.district_name}</span>
                    <span className="text-ink-soft">{travelLabel(a.travel_fee, a.travel_note)}</span>
                  </li>
                ))}
                {areas.length > 6 && <li className="py-1 text-ink-soft">and {areas.length - 6} more</li>}
              </ul>
            )}
            <Link href="/vendor/areas" className="btn btn-secondary btn-sm mt-3">
              Edit districts and travel
            </Link>
          </section>
          <nav className="card text-sm" aria-label="Other business settings">
            <ul>
              <li>
                <Link href="/vendor/offerings" className="flex items-center justify-between min-h-11 hover:text-accent">
                  Offerings and prices <span aria-hidden="true" className="text-ink-soft">→</span>
                </Link>
              </li>
              <li className="border-t border-line">
                <Link href="/vendor/media" className="flex items-center justify-between min-h-11 hover:text-accent">
                  Logo, cover and photos <span aria-hidden="true" className="text-ink-soft">→</span>
                </Link>
              </li>
              <li className="border-t border-line">
                <Link href="/vendor/settings" className="flex items-center justify-between min-h-11 hover:text-accent">
                  Sign-in and notifications <span aria-hidden="true" className="text-ink-soft">→</span>
                </Link>
              </li>
            </ul>
          </nav>
        </aside>
      </div>
    </main>
  );
}
