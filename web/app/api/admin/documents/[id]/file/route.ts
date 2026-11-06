import { requireAdmin } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { getDocumentFile } from "@/lib/admin/documents";
import { getStorage } from "@/lib/storage";

// GET /api/admin/documents/[id]/file: streams a private vendor document to
// an admin (401 signed out, 403 any other role). Never cached.
const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function plain(status: number, text: string) {
  return new Response(text, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseId((await params).id);
  if (id === null) return plain(404, "Not found");
  try {
    const ref = await getDocumentFile(id);
    if (!ref) return plain(404, "Not found");
    const obj = await getStorage(ref.driver).get(ref.key);
    if (!obj) return plain(404, "File missing");
    const ext = ref.mime === "application/pdf" ? "pdf" : ref.mime === "image/png" ? "png" : "jpg";
    const body = obj.body instanceof ReadableStream ? obj.body : new Uint8Array(obj.body);
    return new Response(body, {
      status: 200,
      headers: {
        ...HEADERS,
        "Content-Type": ref.mime,
        "Content-Length": String(obj.bytes),
        "Content-Disposition": `inline; filename="vendor-${ref.vendorId}-${ref.docType}-${id}.${ext}"`,
      },
    });
  } catch (err) {
    console.error("admin document file", err);
    return plain(500, "Could not read the file");
  }
}
