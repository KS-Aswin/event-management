import { NextResponse } from "next/server";
import {
  findVendorByOwner,
  createVendorListing,
  districtExists,
  findCategories,
  toPublicVendor,
} from "@/lib/db";
import { getLiveSession } from "../_lib/auth";
import { validateListingFields } from "../_lib/validation";
import { DEFAULT_PAGE_SIZE, parseSearchParams, searchOfferings, searchVendors } from "@/lib/search";

// Params that opt a request into the v2 default ranking (featured -> boost -> rating -> completeness).
const V2_PARAMS = [
  "view", "offering", "eventType", "district", "homeOnly", "date", "budgetMax", "priceUnit", "guests", "verified", "page",
];

/**
 * Public search (P2-7). Legacy params (q, category, location, minRating,
 * maxPrice, sort, limit, offset) keep their meaning; v2 adds view, offering,
 * eventType, district (id or name; home or served district), homeOnly, date,
 * budgetMax + priceUnit, guests, verified and page. An invalid value is a 400
 * naming the field. Without page/limit the vendors view returns every match
 * (legacy); the offerings view always pages (20 by default).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = await parseSearchParams(searchParams, { strict: true, defaultPageSize: null });
  if (!parsed.ok) {
    return NextResponse.json({ field: parsed.field, error: parsed.error }, { status: 400 });
  }
  const f = parsed.filters;
  let { page, pageSize } = parsed;
  // A legacy request without a sort keeps the old default (highest rated).
  if (!searchParams.get("sort") && !V2_PARAMS.some((k) => searchParams.has(k))) f.sort = "rating";

  if (f.view === "offerings") {
    if (f.limit === undefined) {
      pageSize = DEFAULT_PAGE_SIZE;
      page = 1;
      f.limit = pageSize;
      f.offset = 0;
    }
    const { offerings, total } = await searchOfferings(f);
    return NextResponse.json({ view: "offerings", offerings, total, page, pageSize });
  }

  const { vendors, total } = await searchVendors(f);
  return NextResponse.json({
    view: "vendors",
    vendors: vendors.map((v) => ({ ...toPublicVendor(v), featured: v.featured })),
    total,
    page,
    pageSize,
  });
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
    // Valid categories come from the categories table only (P0-8).
    categories: await findCategories(),
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
