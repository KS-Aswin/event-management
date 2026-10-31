import { NextResponse } from "next/server";
import { requireVendor, readJson, apiError } from "@/lib/media/http";
import { reserve } from "@/lib/media/pipeline";

/** Step 1 (docs/PRODUCT_PLAN.md 4.4): check limits and reserve a media_assets row. */
export async function POST(request: Request) {
  const ctx = await requireVendor({ rateKey: "media-upload", max: 120 });
  if (ctx instanceof NextResponse) return ctx;
  const body = await readJson(request);
  if (!body) return apiError(400, "Invalid JSON body.", "VALIDATION");
  const r = await reserve(ctx.vendor, body);
  return NextResponse.json(r.body, { status: r.status });
}
