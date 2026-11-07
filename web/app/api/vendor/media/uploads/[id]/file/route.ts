import { NextResponse } from "next/server";
import { requireVendor, notFound, parsePositiveInt } from "@/lib/media/http";
import { putBytes } from "@/lib/media/pipeline";

/** Step 2 for the local driver: the raw file bytes as the request body (size-capped). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const id = parsePositiveInt((await params).id);
  if (id === null) return notFound();
  const r = await putBytes(ctx.vendor, id, request);
  return NextResponse.json(r.body, { status: r.status });
}
