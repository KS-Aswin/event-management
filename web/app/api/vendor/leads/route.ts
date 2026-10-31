import { NextResponse } from "next/server";
import { requireRole } from "@/app/api/_lib/auth";
import { findLeadsByVendor, getOwnVendor, VENDOR_LEAD_STATUSES, type LeadFilters } from "@/lib/db";

// The signed-in vendor's leads (PRODUCT_PLAN P0-14, section 6).
// Filters: status, from, to (event date, YYYY-MM-DD), district, serviceId,
// limit, offset. Each lead carries the requested units with qty and snapshot.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function bad(field: string, error: string) {
  return NextResponse.json({ error, field, code: "VALIDATION" }, { status: 400 });
}

function posInt(v: string | null): number | null | "invalid" {
  if (v === null || v === "") return null;
  if (!/^\d{1,10}$/.test(v)) return "invalid";
  const n = Number(v);
  return n > 0 && n <= 2_147_483_647 ? n : "invalid";
}

export async function GET(request: Request) {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) return NextResponse.json({ error: "Create your business listing first.", code: "NO_LISTING" }, { status: 404 });

  const sp = new URL(request.url).searchParams;
  const f: LeadFilters = {};
  const status = sp.get("status");
  if (status && status !== "all") {
    if (!(VENDOR_LEAD_STATUSES as readonly string[]).includes(status)) return bad("status", "Unknown status.");
    f.status = status;
  }
  for (const key of ["from", "to"] as const) {
    const v = sp.get(key);
    if (!v) continue;
    if (!isRealDate(v)) return bad(key, "Use a date like 2026-12-31.");
    f[key] = v;
  }
  const district = posInt(sp.get("district"));
  if (district === "invalid") return bad("district", "Unknown district.");
  if (district) f.districtId = district;
  const serviceId = posInt(sp.get("serviceId"));
  if (serviceId === "invalid") return bad("serviceId", "Unknown offering.");
  if (serviceId) f.serviceId = serviceId;
  const limit = posInt(sp.get("limit"));
  if (limit === "invalid") return bad("limit", "Invalid limit.");
  if (limit) f.limit = limit;
  const offset = sp.get("offset");
  if (offset) {
    if (!/^\d{1,9}$/.test(offset)) return bad("offset", "Invalid offset.");
    f.offset = Number(offset);
  }

  const leads = await findLeadsByVendor(vendor.id, f);
  return NextResponse.json({ leads }, { headers: { "Cache-Control": "private, no-store" } });
}
