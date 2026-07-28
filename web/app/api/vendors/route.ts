import { NextResponse } from "next/server";
import { findVendors } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const query = searchParams.get("q") ?? undefined;
  const categories = searchParams.getAll("category").filter(Boolean);
  const location = searchParams.get("location") ?? undefined;
  const minRatingRaw = searchParams.get("minRating");
  const minRating = minRatingRaw ? parseFloat(minRatingRaw) : undefined;
  const sortRaw = searchParams.get("sort");
  const sort =
    sortRaw === "reviews" || sortRaw === "priceLow" || sortRaw === "priceHigh"
      ? sortRaw
      : "rating";

  const vendors = await findVendors({
    query,
    categories: categories.length > 0 ? categories : undefined,
    location,
    minRating,
    sort,
  });

  return NextResponse.json({ vendors });
}
