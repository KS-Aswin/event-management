import { NextResponse } from "next/server";
import { requireVendor } from "@/lib/media/http";
import { reorderOfferings } from "@/lib/db";
import { apiError, readBody } from "../_lib";

/** POST {ids:[...]} in display order. Ids that aren't the caller's are ignored. */
export async function POST(request: Request) {
  const v = await requireVendor({ rateKey: "offerings-write", max: 300 });
  if (v instanceof NextResponse) return v;
  const body = await readBody(request);
  const raw = body?.ids;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) {
    return apiError(400, "ids must be a list of offering ids.", "VALIDATION", { field: "ids" });
  }
  const ids = raw.map((x) => (typeof x === "number" && Number.isInteger(x) && x > 0 && x <= 2147483647 ? x : null));
  if (ids.some((x) => x === null) || new Set(ids).size !== ids.length) {
    return apiError(400, "ids must be unique offering ids.", "VALIDATION", { field: "ids" });
  }
  await reorderOfferings(v.vendor.id, ids as number[]);
  return NextResponse.json({ ok: true });
}
