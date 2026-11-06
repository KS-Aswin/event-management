import { requireRole } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { bad, handleThreadError, json, readObject, tooMany } from "@/app/api/_lib/thread-http";
import { getOwnVendor } from "@/lib/db";
import { cleanMessageBody, getVendorThread, markThreadRead, postMessage } from "@/lib/enquiry-thread";
import { checkRateLimit } from "@/lib/rate-limit";

// Thread of one of the signed-in vendor's leads (PRODUCT_PLAN P2-5).
// GET: messages, offers and status events (marks the customer's messages
// and this lead's notifications read). POST {body}: a reply; the first reply
// moves a new lead to "responded". Another vendor's lead is 403.

const forbidden = () => json(403, { error: "This enquiry wasn't sent to your listing.", code: "FORBIDDEN" });

async function context(params: Promise<{ id: string }>) {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  const leadId = parseId((await params).id);
  if (leadId === null) return bad("id", "Invalid enquiry id.");
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) return forbidden();
  return { userId: auth.userId, vendorId: vendor.id, leadId };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(params);
  if (ctx instanceof Response) return ctx;
  const thread = await getVendorThread(ctx.vendorId, ctx.leadId);
  if (!thread) return forbidden();
  await markThreadRead(ctx.leadId, "vendor", ctx.userId);
  return json(200, { thread });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(params);
  if (ctx instanceof Response) return ctx;
  const body = await readObject(request);
  if (!body) return bad("body", "Invalid request body.");
  const text = cleanMessageBody(body.body);
  if (!text) return bad("body", "Write a message (up to 4000 characters).");
  if (!checkRateLimit(`thread-msg:${ctx.userId}`, 20, 60_000)) return tooMany();
  try {
    const r = await postMessage({ role: "vendor", vendorId: ctx.vendorId, userId: ctx.userId }, ctx.leadId, text);
    if (!r) return forbidden();
    return json(201, { message: r.message, status: r.status });
  } catch (err) {
    return handleThreadError(err);
  }
}
