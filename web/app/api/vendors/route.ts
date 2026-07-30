import { NextResponse } from "next/server";
import { findVendors, findVendorByOwner, createVendorListing } from "@/lib/db";
import { getSession } from "@/lib/session";
import { CATEGORIES } from "@/lib/vendorVisuals";

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

  const { name, category, location, price, experience, tags, about } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof name !== "string" || name.trim().length < 2) {
    return NextResponse.json({ error: "Please enter a business name." }, { status: 400 });
  }
  if (typeof category !== "string" || !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "Please choose a valid category." }, { status: 400 });
  }
  if (typeof location !== "string" || location.trim().length < 2) {
    return NextResponse.json({ error: "Please enter a location." }, { status: 400 });
  }
  const priceNum = typeof price === "number" ? price : parseInt(String(price), 10);
  if (!priceNum || priceNum <= 0) {
    return NextResponse.json({ error: "Please enter a valid starting price." }, { status: 400 });
  }
  if (typeof experience !== "string" || experience.trim().length < 1) {
    return NextResponse.json({ error: "Please enter your years of experience." }, { status: 400 });
  }
  if (typeof about !== "string" || about.trim().length < 10) {
    return NextResponse.json(
      { error: "Please write at least a short description (10+ characters)." },
      { status: 400 }
    );
  }

  const tagList = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  const vendor = await createVendorListing({
    ownerId: session.userId,
    name: name.trim(),
    category,
    location: location.trim(),
    price: priceNum,
    priceLabel: `₹${priceNum.toLocaleString("en-IN")} onwards`,
    experience: experience.trim(),
    tags: tagList,
    about: about.trim(),
  });

  return NextResponse.json({ vendor }, { status: 201 });
}
