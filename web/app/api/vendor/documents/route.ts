import { NextResponse } from "next/server";
import { requireVendor, apiError } from "@/lib/media/http";
import { isHttpError } from "@/lib/admin/tx";
import {
  createOwnDocument,
  isDocType,
  listOwnDocuments,
  parseDocNumber,
  parseExpiry,
} from "@/lib/admin/documents";
import { MAX_DOC_BYTES } from "@/app/vendor/documents/doc-meta";

const NO_STORE = { "Cache-Control": "private, no-store" };

// P1-10 vendor documents. The vendor comes from the session, so every query
// is scoped to the caller's own listing.

/** GET /api/vendor/documents -> { documents: VendorDocument[] } */
export async function GET() {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const documents = await listOwnDocuments(ctx.vendor.id);
  return NextResponse.json({ documents }, { headers: NO_STORE });
}

/**
 * POST /api/vendor/documents (multipart/form-data):
 *   file (PDF / JPEG / PNG, <= 4 MB, checked by magic bytes),
 *   docType (gst | trade_licence | fssai | pan | other), number?, expiresAt? (YYYY-MM-DD)
 * -> 201 { document }
 */
export async function POST(request: Request) {
  const ctx = await requireVendor({ rateKey: "doc-upload", max: 30 });
  if (ctx instanceof NextResponse) return ctx;

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_DOC_BYTES + 64 * 1024) {
    return apiError(413, "The file is larger than 4 MB.", "TOO_LARGE", { field: "file" });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "Send the document as a form upload.", "VALIDATION");
  }
  const docType = form.get("docType");
  if (!isDocType(docType)) return apiError(400, "Choose the document type.", "VALIDATION", { field: "docType" });
  const number = parseDocNumber(form.get("number") ?? undefined);
  if (number === "invalid") {
    return apiError(400, "Use letters, numbers, spaces, / or - (up to 40).", "VALIDATION", { field: "number" });
  }
  const expiresAt = parseExpiry(form.get("expiresAt") ?? undefined);
  if (expiresAt === "invalid") return apiError(400, "Enter a valid expiry date.", "VALIDATION", { field: "expiresAt" });
  const file = form.get("file");
  if (!file || typeof file === "string") return apiError(400, "Choose a file to upload.", "VALIDATION", { field: "file" });
  if (file.size > MAX_DOC_BYTES) return apiError(413, "The file is larger than 4 MB.", "TOO_LARGE", { field: "file" });

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const document = await createOwnDocument({ vendorId: ctx.vendor.id, docType, number, expiresAt, data });
    return NextResponse.json({ document }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (isHttpError(err)) return apiError(err.status, err.message, err.code ?? "ERROR", { field: "file" });
    console.error("vendor document upload", err);
    return apiError(500, "Could not save the document. Please try again.", "ERROR");
  }
}
