import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findVendorServiceAreas, getOwnVendor } from "@/lib/db";
import { getTaxonomy } from "@/lib/taxonomy";
import AreasForm from "./areas-form";

export const metadata: Metadata = { title: "Districts you serve" };

// Served districts with travel fee or note (PRODUCT_PLAN 2.4 /vendor/areas,
// 3.6, P0-13). Saves through PUT /api/vendor/profile/areas.
export default async function VendorAreasPage() {
  const { session } = await requirePageRole("vendor");
  const vendor = await getOwnVendor(session.userId);
  if (!vendor) redirect("/vendor/onboarding");
  const [taxonomy, areas] = await Promise.all([getTaxonomy(), findVendorServiceAreas(vendor.id)]);
  const districts = taxonomy.districts.map((d) => ({ id: d.id, name: d.name }));
  const home = districts.find((d) => d.id === vendor.district_id) ?? null;

  return (
    <main className="page py-6 sm:py-8">
      <Link href="/vendor/profile" className="btn btn-ghost btn-sm -ml-3.5 mb-2">
        <span aria-hidden="true">←</span> Profile &amp; business
      </Link>
      <header className="mb-6">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Districts you serve</h1>
        <p className="text-ink-soft text-lead mt-1 max-w-[62ch]">
          Customers searching in these districts can find you. Add a travel fee or a note where you charge for travel.
        </p>
      </header>
      <AreasForm
        districts={districts}
        home={home}
        initialAreas={areas.map((a) => ({ districtId: a.district_id, travelFee: a.travel_fee, travelNote: a.travel_note }))}
        initialOutsideKerala={!!vendor.travel_outside_kerala}
      />
    </main>
  );
}
