import { NextResponse } from "next/server";
import { requireRole } from "@/app/api/_lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  findDistricts,
  findVendorServiceAreas,
  getOwnVendor,
  setVendorServiceAreas,
  updateVendorStep,
} from "@/lib/db";
import { parseAreasBody } from "../validate";

// Served districts with travel fee / note (PRODUCT_PLAN 3.6, P0-13).
// GET returns the set; PUT replaces it. The home district is always served,
// so it is not stored as a row (search matches it separately).

function err(status: number, error: string, code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

async function ownVendor() {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) return err(404, "Create your business listing first.", "NO_LISTING");
  return { userId: auth.userId, vendor };
}

export async function GET() {
  const ctx = await ownVendor();
  if (ctx instanceof Response) return ctx;
  const areas = await findVendorServiceAreas(ctx.vendor.id);
  return NextResponse.json({
    homeDistrictId: ctx.vendor.district_id,
    travelOutsideKerala: !!ctx.vendor.travel_outside_kerala,
    areas,
  });
}

export async function PUT(request: Request) {
  const ctx = await ownVendor();
  if (ctx instanceof Response) return ctx;
  if (!checkRateLimit(`vendor-areas:${ctx.userId}`, 60, 10 * 60_000)) {
    return err(429, "Too many changes. Please wait a few minutes and try again.", "RATE_LIMITED");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Invalid request body.", "VALIDATION", { field: "body" });
  }
  const parsed = parseAreasBody(body);
  if (!parsed.ok) return err(400, parsed.error, parsed.code, { field: parsed.field });

  const known = new Set((await findDistricts()).map((d) => d.id));
  const unknown = parsed.areas.find((a) => !known.has(a.districtId));
  if (unknown) return err(400, "Choose districts from the list.", "VALIDATION", { field: "areas" });

  // The home district needs no row; drop it if sent.
  const areas = parsed.areas.filter((a) => a.districtId !== ctx.vendor.district_id);
  const saved = await setVendorServiceAreas(ctx.vendor.id, areas);
  let travelOutsideKerala = !!ctx.vendor.travel_outside_kerala;
  if (parsed.travelOutsideKerala !== undefined && parsed.travelOutsideKerala !== travelOutsideKerala) {
    const v = await updateVendorStep(ctx.vendor.id, { travelOutsideKerala: parsed.travelOutsideKerala });
    travelOutsideKerala = !!v?.travel_outside_kerala;
  }
  return NextResponse.json({ homeDistrictId: ctx.vendor.district_id, travelOutsideKerala, areas: saved });
}
