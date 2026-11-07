import { NextResponse } from "next/server";
import { getLiveSession } from "../../../_lib/auth";
import { parseId } from "../../../_lib/validation";
import { findVendorById, addFavorite, removeFavorite } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in to save favorites." }, { status: 401 });
  }

  const { id } = await params;
  const vendorId = parseId(id);
  if (vendorId === null) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  const vendor = await findVendorById(vendorId, { publicOnly: true, viewerId: session.userId });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  await addFavorite(session.userId, vendorId);
  return NextResponse.json({ favorited: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const { id } = await params;
  const vendorId = parseId(id);
  if (vendorId === null) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  await removeFavorite(session.userId, vendorId);
  return NextResponse.json({ favorited: false });
}
