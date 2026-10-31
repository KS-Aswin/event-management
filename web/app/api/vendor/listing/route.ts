import { NextResponse } from "next/server";
import { requireRole } from "@/app/api/_lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  countMediaByVendor,
  createDraftListing,
  districtExists,
  findCategoryById,
  findListingMissing,
  findVendorCategoryIds,
  findVendorServiceAreas,
  getOwnVendor,
  isCheckViolation,
  setVendorServiceAreas,
  updateVendorStep,
} from "@/lib/db";
import { MISSING_MESSAGES, parseListingBody, toClientListing, type ParsedListing } from "./_parse";

// /api/vendor/listing: the caller's own business listing (PRODUCT_PLAN 6).
// The vendor is always resolved from the session, never from the client.

function err(status: number, error: string, code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Everything the wizard needs about the caller's listing (re-read after each write). */
async function payload(userId: number) {
  const vendor = await getOwnVendor(userId);
  if (!vendor) {
    return { listing: null, additionalCategoryIds: [], serviceAreas: [], missing: [], missingMessages: [], media: null };
  }
  const [additionalCategoryIds, serviceAreas, missing, media] = await Promise.all([
    findVendorCategoryIds(vendor.id),
    findVendorServiceAreas(vendor.id),
    findListingMissing(vendor.id),
    countMediaByVendor(vendor.id),
  ]);
  return {
    listing: toClientListing(vendor),
    additionalCategoryIds,
    serviceAreas,
    missing,
    missingMessages: missing.map((m) => MISSING_MESSAGES[m] ?? m),
    media,
  };
}

/** Checks the ids in a patch exist (district, categories). Returns an error response or null. */
async function checkReferences(p: ParsedListing): Promise<NextResponse | null> {
  if (p.districtId !== undefined && !(await districtExists(p.districtId))) {
    return err(400, "Please choose your home district.", "VALIDATION", { field: "districtId" });
  }
  if (p.primaryCategoryId !== undefined) {
    const c = await findCategoryById(p.primaryCategoryId);
    if (!c || !c.active) return err(400, "Please choose your main category.", "VALIDATION", { field: "primaryCategoryId" });
  }
  if (p.additionalCategoryIds?.length) {
    const found = await Promise.all(p.additionalCategoryIds.map((id) => findCategoryById(id)));
    if (found.some((c) => !c || !c.active)) {
      return err(400, "Please choose valid categories.", "VALIDATION", { field: "additionalCategoryIds" });
    }
  }
  return null;
}

async function applyPatch(vendorId: number, p: ParsedListing) {
  const { serviceAreas, ...patch } = p;
  if (Object.keys(patch).length) {
    const updated = await updateVendorStep(vendorId, patch);
    if (!updated) return false;
  }
  if (serviceAreas) await setVendorServiceAreas(vendorId, serviceAreas);
  return true;
}

function dbError(e: unknown) {
  if (isCheckViolation(e)) return err(400, "One of the values isn't allowed. Please check the form.", "VALIDATION");
  console.error("/api/vendor/listing failed", e);
  return err(500, "Something went wrong. Please try again.", "SERVER_ERROR");
}

export async function GET() {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  return NextResponse.json(await payload(auth.userId));
}

/** Wizard step 1: creates the draft listing (status 'draft', not public). 409 if one exists. */
export async function POST(request: Request) {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(`listing-create:${auth.userId}`, 10, 10 * 60_000)) {
    return err(429, "Too many attempts. Please wait a few minutes.", "RATE_LIMITED");
  }
  if (await getOwnVendor(auth.userId)) return err(409, "You already have a listing.", "LISTING_EXISTS");
  const body = await readBody(request);
  if (!body) return err(400, "Invalid request body.", "VALIDATION");
  const parsed = parseListingBody(body);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });
  const p = parsed.patch;
  if (!p.name) return err(400, "Please enter your business name.", "VALIDATION", { field: "name" });
  if (!p.primaryCategoryId) return err(400, "Please choose your main category.", "VALIDATION", { field: "primaryCategoryId" });
  const bad = await checkReferences(p);
  if (bad) return bad;

  try {
    const created = await createDraftListing({
      ownerId: auth.userId,
      name: p.name,
      vendorType: p.vendorType ?? "individual",
      primaryCategoryId: p.primaryCategoryId,
      districtId: p.districtId ?? null,
      location: p.location ?? null,
      phone: p.phone ?? null,
      whatsapp: p.whatsapp ?? null,
    });
    if (!created) return err(409, "You already have a listing.", "LISTING_EXISTS");
    const rest: ParsedListing = { ...p };
    for (const k of ["name", "vendorType", "primaryCategoryId", "districtId", "location", "phone", "whatsapp"] as const) {
      delete rest[k];
    }
    await applyPatch(created.id, rest);
    return NextResponse.json(await payload(auth.userId), { status: 201 });
  } catch (e) {
    return dbError(e);
  }
}

/** Saves one wizard step / profile form. Accepts `onboardingStep` (only moves forward). */
export async function PATCH(request: Request) {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(`listing-patch:${auth.userId}`, 120, 10 * 60_000)) {
    return err(429, "Too many saves. Please wait a few minutes.", "RATE_LIMITED");
  }
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) return err(404, "Create your listing first.", "NO_LISTING");
  const body = await readBody(request);
  if (!body) return err(400, "Invalid request body.", "VALIDATION");
  const parsed = parseListingBody(body);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });
  const bad = await checkReferences(parsed.patch);
  if (bad) return bad;
  try {
    const ok = await applyPatch(vendor.id, parsed.patch);
    if (!ok) return err(400, "Please choose your main category.", "VALIDATION", { field: "primaryCategoryId" });
    return NextResponse.json(await payload(auth.userId));
  } catch (e) {
    return dbError(e);
  }
}
