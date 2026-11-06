import { NextResponse } from "next/server";
import { requireVendor, apiError, notFound, parsePositiveInt } from "@/lib/media/http";
import { isHttpError } from "@/lib/admin/tx";
import { deleteOwnDocument } from "@/lib/admin/documents";

/** DELETE /api/vendor/documents/[id]: own pending or rejected document only (404 for anyone else's). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const id = parsePositiveInt((await params).id);
  if (id === null) return notFound();
  try {
    await deleteOwnDocument(ctx.vendor.id, id);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (isHttpError(err)) return apiError(err.status, err.message, err.code ?? "ERROR");
    console.error("vendor document delete", err);
    return apiError(500, "Could not delete the document. Please try again.", "ERROR");
  }
}
