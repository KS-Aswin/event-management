import { NextResponse } from "next/server";
import { requireVendor, readJson, apiError } from "@/lib/media/http";
import { addLink } from "@/lib/media/pipeline";

/** Adds a YouTube / Instagram / Vimeo link to the gallery. */
export async function POST(request: Request) {
  const ctx = await requireVendor({ rateKey: "media-link", max: 60 });
  if (ctx instanceof NextResponse) return ctx;
  const body = await readJson(request);
  if (!body) return apiError(400, "Invalid JSON body.", "VALIDATION");
  const r = await addLink(ctx.vendor, body);
  return NextResponse.json(r.body, { status: r.status });
}
