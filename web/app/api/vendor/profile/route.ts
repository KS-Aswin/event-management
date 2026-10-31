import { NextResponse } from "next/server";
import { requireRole } from "@/app/api/_lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  districtExists,
  findCategoryById,
  findVendorCategoryIds,
  findVendorServiceAreas,
  getOwnVendor,
  isCheckViolation,
  updateVendorStep,
  type VendorRecord,
} from "@/lib/db";
import { normaliseE164, parseProfileBody } from "./validate";
import { toProfile } from "./shape";

// Business profile of the signed-in vendor (PRODUCT_PLAN P0-13, section 6).
// The vendor is always resolved from the session, never from the client.

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
  const [additional, areas] = await Promise.all([
    findVendorCategoryIds(ctx.vendor.id),
    findVendorServiceAreas(ctx.vendor.id),
  ]);
  return NextResponse.json({ profile: toProfile(ctx.vendor, additional), serviceAreas: areas });
}

export async function PATCH(request: Request) {
  const ctx = await ownVendor();
  if (ctx instanceof Response) return ctx;
  if (!checkRateLimit(`vendor-profile:${ctx.userId}`, 60, 10 * 60_000)) {
    return err(429, "Too many changes. Please wait a few minutes and try again.", "RATE_LIMITED");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Invalid request body.", "VALIDATION", { field: "body" });
  }
  const parsed = parseProfileBody(body);
  if (!parsed.ok) return err(400, parsed.error, parsed.code, { field: parsed.field });
  const patch = parsed.patch;
  const old = ctx.vendor;

  // The same number in a different format is not a change (no re-review).
  if (patch.phone !== undefined && old.phone && normaliseE164(old.phone) === patch.phone && old.phone !== patch.phone) {
    if (old.status === "approved") delete patch.phone;
  }
  if (patch.districtId !== undefined && !(await districtExists(patch.districtId))) {
    return err(400, "Choose your home district from the list.", "VALIDATION", { field: "districtId" });
  }
  if (patch.primaryCategoryId !== undefined) {
    const cat = await findCategoryById(patch.primaryCategoryId);
    if (!cat || !cat.active) {
      return err(400, "Choose your main category from the list.", "VALIDATION", { field: "primaryCategoryId" });
    }
    if (patch.additionalCategoryIds === undefined) {
      // Keep the additional set, minus the new primary.
      const current = await findVendorCategoryIds(old.id);
      if (current.includes(patch.primaryCategoryId)) {
        patch.additionalCategoryIds = current.filter((id) => id !== patch.primaryCategoryId);
      }
    }
  }
  if (patch.additionalCategoryIds && patch.additionalCategoryIds.length) {
    const primary = patch.primaryCategoryId ?? old.primary_category_id ?? 0;
    patch.additionalCategoryIds = patch.additionalCategoryIds.filter((id) => id !== primary);
  }
  if (Object.keys(patch).length === 0) {
    const additional = await findVendorCategoryIds(old.id);
    return NextResponse.json({ profile: toProfile(old, additional), changed: false });
  }

  let updated: VendorRecord | null;
  try {
    updated = await updateVendorStep(old.id, patch);
  } catch (e) {
    if (isCheckViolation(e)) return err(400, "One of the values is out of range.", "VALIDATION");
    throw e;
  }
  if (!updated) return err(400, "Choose your main category from the list.", "VALIDATION", { field: "primaryCategoryId" });
  const additional = await findVendorCategoryIds(updated.id);
  return NextResponse.json({
    profile: toProfile(updated, additional),
    changed: true,
    rereview: !!updated.rereview_required && old.status === "approved",
  });
}
