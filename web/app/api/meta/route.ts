import { NextResponse } from "next/server";
import { findCategories, findDistricts, SERVICE_PRICE_UNITS } from "@/lib/db";

// Public lookup data used by forms and filters: service categories, Kerala
// districts, and the allowed price units for a service.
export async function GET() {
  const [categories, districts] = await Promise.all([findCategories(), findDistricts("Kerala")]);
  return NextResponse.json({ categories, districts, priceUnits: SERVICE_PRICE_UNITS });
}
