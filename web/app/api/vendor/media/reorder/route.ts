import { NextResponse } from "next/server";
import { requireVendor, readJson, apiError, parsePositiveInt } from "@/lib/media/http";
import { reorderAssets } from "@/lib/media/repo";

/** {ids:[...]} in display order. Ids that aren't the caller's are ignored. */
export async function POST(request: Request) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const body = await readJson(request);
  const raw = body?.ids;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) {
    return apiError(400, "ids must be a list of media ids.", "VALIDATION");
  }
  const ids = raw.map(parsePositiveInt);
  if (ids.some((x) => x === null) || new Set(ids).size !== ids.length) {
    return apiError(400, "ids must be unique media ids.", "VALIDATION");
  }
  await reorderAssets(ctx.vendor.id, ids as number[]);
  return NextResponse.json({ ok: true });
}
