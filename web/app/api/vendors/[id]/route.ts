import { NextResponse } from "next/server";
import {
  findVendorById,
  findReviewsByVendor,
  updateVendorListing,
  buildPriceLabel,
  PRICE_UNITS,
} from "@/lib/db";
import { getSession } from "@/lib/session";
import { CATEGORIES } from "@/lib/vendorVisuals";
import { toPublicVendor } from "@/lib/vendor-auth";
import { listPackages, listPortfolio, listUnavailableDates } from "@/lib/vendor-content";
import { positiveInt } from "@/lib/validate";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vendorId = parseInt(id, 10);
  if (Number.isNaN(vendorId)) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  const vendor = await findVendorById(vendorId);
  const session = await getSession();
  // Unpublished listings are visible only to their owner.
  if (!vendor || (!vendor.published && vendor.owner_id !== session?.userId)) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  const [reviews, packages, portfolio, unavailableDates] = await Promise.all([
    findReviewsByVendor(vendorId),
    listPackages(vendorId),
    listPortfolio(vendorId),
    listUnavailableDates(vendorId),
  ]);

  return NextResponse.json({
    vendor: toPublicVendor(vendor),
    reviews,
    packages,
    portfolio,
    unavailableDates,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const vendorId = parseInt(id, 10);
  if (Number.isNaN(vendorId)) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
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

  if (category !== undefined && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "Please choose a valid category." }, { status: 400 });
  }
  if (
    priceUnit !== undefined &&
    (typeof priceUnit !== "string" || !PRICE_UNITS.includes(priceUnit as (typeof PRICE_UNITS)[number]))
  ) {
    return NextResponse.json({ error: "Please choose a valid price type." }, { status: 400 });
  }

  // The price label combines price + unit, so we need the current values to
  // rebuild it when only one of them changes. Not-found and not-yours share
  // one 404 on purpose (see requireOwnedVendor).
  const current = await findVendorById(vendorId);
  if (!current || current.owner_id !== session.userId) {
    return NextResponse.json(
      { error: "Listing not found, or you don't own it." },
      { status: 404 }
    );
  }

  let priceNum: number | undefined;
  if (price !== undefined) {
    const parsed = positiveInt(price);
    if (!parsed) {
      return NextResponse.json({ error: "Please enter a valid starting price." }, { status: 400 });
    }
    priceNum = parsed;
  }
  const unit = typeof priceUnit === "string" ? priceUnit : undefined;
  const priceLabel =
    priceNum !== undefined || unit !== undefined
      ? buildPriceLabel(priceNum ?? current.price, unit ?? current.price_unit)
      : undefined;

  const tagList = Array.isArray(tags)
    ? tags
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 30))
        .slice(0, 10)
    : undefined;

  const updated = await updateVendorListing(vendorId, session.userId, {
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : undefined,
    category: typeof category === "string" ? category : undefined,
    location: typeof location === "string" && location.trim() ? location.trim().slice(0, 80) : undefined,
    price: priceNum,
    priceLabel,
    priceUnit: unit,
    experience: typeof experience === "string" && experience.trim() ? experience.trim().slice(0, 40) : undefined,
    tags: tagList,
    about: typeof about === "string" && about.trim() ? about.trim().slice(0, 3000) : undefined,
  });

  // The WHERE clause matches on (id AND owner_id) as well, so even if
  // ownership changed between the lookup above and this update, it can't
  // modify someone else's row.
  if (!updated) {
    return NextResponse.json(
      { error: "Listing not found, or you don't own it." },
      { status: 404 }
    );
  }

  return NextResponse.json({ vendor: updated });
}
