import { requireRole } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { bad, handleThreadError, json, readObject, tooMany } from "@/app/api/_lib/thread-http";
import { cleanMessageBody, postMessage } from "@/lib/enquiry-thread";
import { checkRateLimit } from "@/lib/rate-limit";

// POST /api/my/enquiries/[id]/messages { body }: the customer's message to
// the vendor on their own enquiry (PRODUCT_PLAN P2-5). Someone else's
// enquiry is 404; a withdrawn or expired one is 409.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(["customer", "vendor"]);
  if (auth instanceof Response) return auth;
  const id = parseId((await params).id);
  if (id === null) return json(404, { error: "Enquiry not found.", code: "NOT_FOUND" });
  const body = await readObject(request);
  if (!body) return bad("body", "Invalid request body.");
  const text = cleanMessageBody(body.body);
  if (!text) return bad("body", "Write a message (up to 4000 characters).");
  if (!checkRateLimit(`thread-msg:${auth.userId}`, 20, 60_000)) return tooMany();
  try {
    const r = await postMessage({ role: "customer", scope: { userId: auth.userId }, userId: auth.userId }, id, text);
    if (!r) return json(404, { error: "Enquiry not found.", code: "NOT_FOUND" });
    return json(201, { message: r.message, status: r.status });
  } catch (err) {
    return handleThreadError(err);
  }
}
