import { NextResponse } from "next/server";
import { findVendors, findVendorByOwner, createVendorListing, buildPriceLabel, PRICE_UNITS, DEFAULT_PAGE_SIZE } from "@/lib/db";
import { getSession } from "@/lib/session";
import { CATEGORIES } from "@/lib/vendorVisuals";
import { toPublicVendor } from "@/lib/vendor-auth";
import { positiveInt } from "@/lib/validate";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const query = searchParams.get("q") ?? undefined;
  const categories = searchParams.getAll("category").filter(Boolean);
  const location = searchParams.get("location") ?? undefined;
  const minRatingRaw = searchParams.get("minRating");
  const minRating = minRatingRaw ? parseFloat(minRatingRaw) : undefined;
  const sortRaw = searchParams.get("sort");
  const sort =
    sortRaw === "reviews" || sortRaw === "priceLow" || sortRaw === "priceHigh" || sortRaw === "trending"
      ? sortRaw
      : "rating";
  const page = positiveInt(searchParams.get("page")) ?? 1;
  const pageSize = positiveInt(searchParams.get("pageSize")) ?? DEFAULT_PAGE_SIZE;

  const { vendors, total } = await findVendors({
    query,
    categories: categories.length > 0 ? categories : undefined,
    location,
    minRating: minRating && !Number.isNaN(minRating) ? minRating : undefined,
    sort,
    page,
    pageSize,
  });

  return NextResponse.json({
    vendors: vendors.map(toPublicVendor),
    total,
    page,
    pageSize: Math.min(pageSize, 50),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.role !== "vendor") {
    return NextResponse.json(
      { error: "Only vendor accounts can create a listing." },
      { status: 403 }
    );
  }

  const existing = await findVendorByOwner(session.userId);
  if (existing) {
    return NextResponse.json({ error: "You already have a listing." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, category, location, price, priceUnit, experience, tags, about } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
    return NextResponse.json({ error: "Please enter a business name (2–100 characters)." }, { status: 400 });
  }
  if (typeof category !== "string" || !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "Please choose a valid category." }, { status: 400 });
  }
  if (typeof location !== "string" || location.trim().length < 2 || location.trim().length > 80) {
    return NextResponse.json({ error: "Please enter a location." }, { status: 400 });
  }
  const priceNum = positiveInt(price);
  if (!priceNum) {
    return NextResponse.json({ error: "Please enter a valid starting price." }, { status: 400 });
  }
  const unit = priceUnit === undefined ? "onwards" : priceUnit;
  if (typeof unit !== "string" || !PRICE_UNITS.includes(unit as (typeof PRICE_UNITS)[number])) {
    return NextResponse.json({ error: "Please choose a valid price type." }, { status: 400 });
  }
  if (typeof experience !== "string" || experience.trim().length < 1 || experience.trim().length > 40) {
    return NextResponse.json({ error: "Please enter your years of experience." }, { status: 400 });
  }
  if (typeof about !== "string" || about.trim().length < 10 || about.trim().length > 3000) {
    return NextResponse.json(
      { error: "Please write a short description (10–3000 characters)." },
      { status: 400 }
    );
  }

  const tagList = Array.isArray(tags)
    ? tags
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 30))
        .slice(0, 10)
    : [];

  const vendor = await createVendorListing({
    ownerId: session.userId,
    name: name.trim(),
    category,
    location: location.trim(),
    price: priceNum,
    priceLabel: buildPriceLabel(priceNum, unit),
    priceUnit: unit,
    experience: experience.trim(),
    tags: tagList,
    about: about.trim(),
  });

  return NextResponse.json({ vendor }, { status: 201 });
}
