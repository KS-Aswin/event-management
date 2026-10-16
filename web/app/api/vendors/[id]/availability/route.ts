import { NextResponse } from "next/server";
import { findVendorById } from "@/lib/db";
import { requireOwnedVendor } from "@/lib/vendor-auth";
import { listUnavailableDates, replaceUnavailableDates } from "@/lib/vendor-content";
import { isValidDateString, todayString } from "@/lib/validate";

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
  return NextResponse.json({ unavailableDates: await listUnavailableDates(vendorId) });
}

// Replaces the vendor's upcoming unavailable dates with the list provided.
export async function PUT(
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
  const { dates } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(dates) || dates.length > 366) {
    return NextResponse.json({ error: "Provide a list of up to 366 dates." }, { status: 400 });
  }
  const today = todayString();
  const clean: string[] = [];
  for (const d of dates) {
    if (typeof d !== "string" || !isValidDateString(d)) {
      return NextResponse.json({ error: `"${String(d)}" is not a valid date (use YYYY-MM-DD).` }, { status: 400 });
    }
    if (d >= today && !clean.includes(d)) clean.push(d);
  }

  const ok = await replaceUnavailableDates(owned.vendor.id, owned.userId, clean);
  if (!ok) {
    return NextResponse.json({ error: "Listing not found, or you don't own it." }, { status: 404 });
  }
  return NextResponse.json({ unavailableDates: await listUnavailableDates(owned.vendor.id) });
}
