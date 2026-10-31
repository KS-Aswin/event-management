import { NextResponse } from "next/server";
import {
  findVendorById,
  findReviewsByVendor,
  findServicesByVendor,
  findPortfolioByVendor,
  updateVendorListing,
  districtExists,
  toPublicVendor,
} from "@/lib/db";
import { getSession } from "@/lib/session";
import { CATEGORIES } from "@/lib/vendorVisuals";
import { getLiveSession } from "../../_lib/auth";
import { parseId, validateListingFields } from "../../_lib/validation";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vendorId = parseId(id);
  if (vendorId === null) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  // Unapproved/unpublished listings are visible only to their owner.
  const session = await getSession();
  const vendor = await findVendorById(vendorId, { publicOnly: true, viewerId: session?.userId ?? null });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }
  const isOwner = session?.userId != null && vendor.owner_id === session.userId;

  const [reviews, services, portfolio] = await Promise.all([
    findReviewsByVendor(vendorId),
    findServicesByVendor(vendorId),
    findPortfolioByVendor(vendorId),
  ]);

  return NextResponse.json({
    vendor: isOwner ? vendor : toPublicVendor(vendor),
    reviews,
    services,
    portfolio,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const vendorId = parseId(id);
  if (vendorId === null) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Same rules and messages as create; a field that is sent but invalid is a
  // 400 instead of being silently ignored.
  const parsed = validateListingFields(body, { partial: true, categories: CATEGORIES });
  if (!parsed.ok) {
    return NextResponse.json({ field: parsed.field, error: parsed.error }, { status: 400 });
  }
  const f = parsed.fields;
  if (f.districtId !== undefined && !(await districtExists(f.districtId))) {
    return NextResponse.json({ field: "districtId", error: "Please choose a valid district." }, { status: 400 });
  }

  const updated = await updateVendorListing(vendorId, session.userId, {
    name: f.name,
    category: f.category,
    location: f.location,
    price: f.price,
    priceLabel: f.price !== undefined ? `₹${f.price.toLocaleString("en-IN")} onwards` : undefined,
    experience: f.experience,
    tags: f.tags,
    about: f.about,
    districtId: f.districtId,
  });

  // updateVendorListing's WHERE clause matches on (id AND owner_id) together,
  // so a null result here means either the listing doesn't exist or it
  // doesn't belong to this user — deliberately the same 404 for both, so a
  // caller can't use this endpoint to probe which vendor ids exist and are
  // (or aren't) owned by someone else.
  if (!updated) {
    return NextResponse.json(
      { error: "Listing not found, or you don't own it." },
      { status: 404 }
    );
  }

  return NextResponse.json({ vendor: updated });
}
