import { NextResponse } from "next/server";
import { requireVendor, notFound, parsePositiveInt, readJson } from "@/lib/media/http";
import { complete } from "@/lib/media/pipeline";

/** Step 3: validate magic bytes and size, make variants, set the moderation status. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const id = parsePositiveInt((await params).id);
  if (id === null) return notFound();
  const body = (await readJson(request)) ?? {};
  const r = await complete(ctx.vendor, id, body);
  return NextResponse.json(r.body, { status: r.status });
}
