import { NextResponse } from "next/server";
import { createService, findCategories, findServicesByVendor, findVendorById } from "@/lib/db";
import { getSession } from "@/lib/session";
import { parseServiceBody } from "@/lib/service-validation";

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
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }
  const services = await findServicesByVendor(vendorId);
  return NextResponse.json({ services });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.role !== "vendor") {
    return NextResponse.json({ error: "Only vendor accounts can add services." }, { status: 403 });
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

  const parsed = parseServiceBody(body, true);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { category, title, description, priceFrom, priceUnit } = parsed.fields;

  const categories = await findCategories();
  if (!category || !categories.includes(category)) {
    return NextResponse.json({ error: "Please choose a valid category." }, { status: 400 });
  }

  const service = await createService({
    vendorId,
    ownerId: session.userId,
    category,
    title: title as string,
    description: description ?? "",
    priceFrom: priceFrom as number,
    priceUnit: priceUnit ?? "event",
  });

  // Same 404 whether the vendor doesn't exist or isn't theirs, so this
  // endpoint can't be used to probe other vendors' listings.
  if (!service) {
    return NextResponse.json(
      { error: "Listing not found, or you don't own it." },
      { status: 404 }
    );
  }

  return NextResponse.json({ service }, { status: 201 });
}
