import { NextResponse } from "next/server";
import {
  findVendors,
  countVendors,
  findVendorByOwner,
  createVendorListing,
  districtExists,
  findCategories,
  toPublicVendor,
} from "@/lib/db";
import { CATEGORIES } from "@/lib/vendorVisuals";
import { getLiveSession } from "../_lib/auth";
import { parseId, validateListingFields } from "../_lib/validation";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // searchParams.get() takes the first value when a param is repeated.
  const query = searchParams.get("q")?.trim().replace(/\s+/g, " ") || undefined;
  const categories = searchParams.getAll("category").filter(Boolean);
  const location = searchParams.get("location")?.trim() || undefined;
  const minRatingRaw = parseFloat(searchParams.get("minRating") ?? "");
  const minRating = Number.isFinite(minRatingRaw) && minRatingRaw > 0 && minRatingRaw <= 5 ? minRatingRaw : undefined;
  const maxPriceRaw = parseInt(searchParams.get("maxPrice") ?? "", 10);
  const maxPrice = Number.isFinite(maxPriceRaw) && maxPriceRaw > 0 ? maxPriceRaw : undefined;
  const districtId = parseId(searchParams.get("district") ?? "") ?? undefined;
  const sortRaw = searchParams.get("sort");
  const sort =
    sortRaw === "reviews" || sortRaw === "priceLow" || sortRaw === "priceHigh"
      ? sortRaw
      : "rating";
  const limitRaw = parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : undefined;
  const offsetRaw = parseInt(searchParams.get("offset") ?? "", 10);
  const offset = limit && Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : undefined;

  const filters = {
    query,
    categories: categories.length > 0 ? categories : undefined,
    location,
    minRating,
    maxPrice,
    districtId,
    sort,
  } as const;

  const [vendors, total] = await Promise.all([
    findVendors({ ...filters, limit, offset }),
    countVendors(filters),
  ]);

  return NextResponse.json({ vendors: vendors.map(toPublicVendor), total });
}

export async function POST(request: Request) {
  const session = await getLiveSession();
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

  const parsed = validateListingFields(body, {
    partial: false,
    // The form offers the categories table; keep the legacy 7 valid too.
    categories: [...new Set<string>([...CATEGORIES, ...(await findCategories())])],
  });
  if (!parsed.ok) {
    return NextResponse.json({ field: parsed.field, error: parsed.error }, { status: 400 });
  }
  const f = parsed.fields;
  if (f.districtId !== undefined && !(await districtExists(f.districtId))) {
    return NextResponse.json({ field: "districtId", error: "Please choose a valid district." }, { status: 400 });
  }

  const price = f.price as number;
  const vendor = await createVendorListing({
    ownerId: session.userId,
    name: f.name as string,
    category: f.category as string,
    location: f.location as string,
    price,
    priceLabel: `₹${price.toLocaleString("en-IN")} onwards`,
    experience: f.experience as string,
    tags: f.tags ?? [],
    about: f.about as string,
    districtId: f.districtId,
    phone: f.phone,
    whatsapp: f.whatsapp,
  });

  // null = a concurrent request created this owner's listing first.
  if (!vendor) {
    return NextResponse.json({ error: "You already have a listing." }, { status: 409 });
  }

  return NextResponse.json({ vendor }, { status: 201 });
}
