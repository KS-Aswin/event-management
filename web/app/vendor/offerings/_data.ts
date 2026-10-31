// Server-side loaders shared by the /vendor/offerings pages.
import { redirect } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findVendorCategoryIds, getOwnVendor } from "@/lib/db";
import { getTaxonomy } from "@/lib/taxonomy";
import { listPayload } from "@/app/api/vendor/offerings/_lib";
import type { Offering, PackageItem, TaxonomyLite } from "@/app/vendor/_components/offering-api";

export async function loadOfferingsPage() {
  const { session } = await requirePageRole("vendor");
  const vendor = await getOwnVendor(session.userId);
  if (!vendor) redirect("/vendor/onboarding");
  const [taxonomy, payload, extra] = await Promise.all([
    getTaxonomy(),
    listPayload(vendor.id),
    findVendorCategoryIds(vendor.id),
  ]);
  const tax = {
    categories: taxonomy.categories,
    templates: taxonomy.templates,
    eventTypes: taxonomy.eventTypes.map((e) => ({ id: e.id, name: e.name })),
    districts: taxonomy.districts.map((d) => ({ id: d.id, name: d.name })),
    priceUnits: taxonomy.priceUnits,
  } as TaxonomyLite;
  return {
    vendor: { id: vendor.id, name: vendor.name, status: vendor.status },
    categoryIds: [vendor.primary_category_id, ...extra].filter((x): x is number => !!x),
    tax,
    offerings: JSON.parse(JSON.stringify(payload.offerings)) as Offering[],
    packageItems: JSON.parse(JSON.stringify(payload.packageItems)) as PackageItem[],
    limit: payload.limit,
  };
}
