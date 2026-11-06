import { requireRole } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { bad, handleThreadError, json, readObject, tooMany } from "@/app/api/_lib/thread-http";
import { getOwnVendor } from "@/lib/db";
import { getVendorThread, sendOffer } from "@/lib/enquiry-thread";
import { parseOfferBody } from "@/lib/offer-math";
import { checkRateLimit } from "@/lib/rate-limit";

// Itemised quote offers on one of the signed-in vendor's leads (P2-4).
// GET: all versions, newest first. POST: send offer vN, which supersedes the
// previous one. Body (money in rupees, stored as paise):
//   { lines: [{ serviceId?, label, qty, unit, unitPrice }], subtotal,
//     travel?, discount?, gst?, total?, validUntil?, advancePct?, terms? }
// 400: lines don't add up to the subtotal, GST without a GSTIN, a foreign
// offering. 409: the enquiry is booked, withdrawn or expired.

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
  return json(200, { offers: thread.offers });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(params);
  if (ctx instanceof Response) return ctx;
  const body = await readObject(request);
  if (!body) return bad("body", "Invalid request body.");
  const parsed = parseOfferBody(body);
  if (!parsed.ok) return bad(parsed.field, parsed.error);
  if (!checkRateLimit(`thread-offer:${ctx.userId}`, 10, 10 * 60_000)) return tooMany();
  try {
    const r = await sendOffer(ctx.vendorId, ctx.userId, ctx.leadId, parsed.offer);
    if (!r) return forbidden();
    return json(201, r);
  } catch (err) {
    return handleThreadError(err);
  }
}
