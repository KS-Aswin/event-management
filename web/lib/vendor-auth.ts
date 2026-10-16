import { NextResponse } from "next/server";
import { findVendorById, type VendorRecord } from "./db";
import { getSession } from "./session";

export type OwnedVendorResult =
  | { ok: true; vendor: VendorRecord; userId: number }
  | { ok: false; response: NextResponse };

// Shared guard for "vendor manages their own listing" routes: must be signed
// in, id must be numeric, and the listing must belong to the caller. A listing
// that doesn't exist and one owned by someone else give the same 404 so the
// endpoint can't be used to probe which ids exist.
export async function requireOwnedVendor(idParam: string): Promise<OwnedVendorResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  const vendorId = parseInt(idParam, 10);
  if (Number.isNaN(vendorId)) {
    return { ok: false, response: NextResponse.json({ error: "Invalid vendor id." }, { status: 400 }) };
  }
  const vendor = await findVendorById(vendorId);
  if (!vendor || vendor.owner_id !== session.userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Listing not found, or you don't own it." }, { status: 404 }),
    };
  }
  return { ok: true, vendor, userId: session.userId };
}

// Removes fields that shouldn't be exposed publicly.
export function toPublicVendor(v: VendorRecord): Omit<VendorRecord, "owner_id"> {
  const copy: Partial<VendorRecord> = { ...v };
  delete copy.owner_id;
  return copy as Omit<VendorRecord, "owner_id">;
}
