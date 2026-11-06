import { NextResponse } from "next/server";
import { findCategoryRecords, findDistricts, SERVICE_PRICE_UNITS } from "@/lib/db";

// Public lookup data used by forms and filters: service categories, Kerala
// districts, and the allowed price units for a service.
//
// `categories` are the stable internal names (the value forms and
// ?category= links send). `categoryOptions` adds what to show: the current
// display name an admin set in /admin/taxonomy (QA-008), plus the slug.
// Read straight from the database (not the 5-minute taxonomy cache), so a
// rename shows here at once.
export const dynamic = "force-dynamic";

export async function GET() {
  const [records, districts] = await Promise.all([findCategoryRecords(), findDistricts("Kerala")]);
  return NextResponse.json({
    categories: records.map((c) => c.name),
    categoryOptions: records.map((c) => ({ value: c.name, slug: c.slug, label: c.display_name?.trim() || c.name })),
    districts,
    priceUnits: SERVICE_PRICE_UNITS,
  });
}
