import { NextResponse } from "next/server";
import { findVendorById } from "@/lib/db";
import { requireOwnedVendor } from "@/lib/vendor-auth";
import { addPackage, listPackages, MAX_PACKAGES } from "@/lib/vendor-content";
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
  if (!vendor || !vendor.published) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }
  return NextResponse.json({ packages: await listPackages(vendorId) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owned = await requireOwnedVendor(id);
  if (!owned.ok) return owned.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { name, price, items } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60) {
    return NextResponse.json({ error: "Package name must be 2–60 characters." }, { status: 400 });
  }
  const priceNum = positiveInt(price);
  if (!priceNum) {
    return NextResponse.json({ error: "Please enter a valid package price." }, { status: 400 });
  }
  const itemList = Array.isArray(items)
    ? items
        .filter((i): i is string => typeof i === "string" && i.trim().length > 0)
        .map((i) => i.trim().slice(0, 80))
        .slice(0, 8)
    : [];

  const existing = await listPackages(owned.vendor.id);
  if (existing.length >= MAX_PACKAGES) {
    return NextResponse.json(
      { error: `You can add up to ${MAX_PACKAGES} packages. Delete one to add another.` },
      { status: 400 }
    );
  }

  const pkg = await addPackage(owned.vendor.id, owned.userId, {
    name: name.trim(),
    price: priceNum,
    items: itemList,
  });
  if (!pkg) {
    return NextResponse.json({ error: "Listing not found, or you don't own it." }, { status: 404 });
  }
  return NextResponse.json({ package: pkg }, { status: 201 });
}
