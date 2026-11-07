import { requireRole } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { bad, handleThreadError, json, readObject } from "@/app/api/_lib/thread-http";
import { cleanMessageBody, customerAct, getCustomerEnquiry, markThreadRead, type CustomerAction } from "@/lib/enquiry-thread";

// One enquiry of the signed-in user (PRODUCT_PLAN P2-4/P2-5).
// GET: details, offers with lines, messages and status timeline (marks the
// vendor's messages and this enquiry's notifications read).
// PATCH { action: "withdraw" | "accept" | "decline" | "booked", offerId?, message? }.
// Someone else's enquiry is 404 (ids can't be probed). Invalid moves are 409.

const notFound = () => json(404, { error: "Enquiry not found.", code: "NOT_FOUND" });

async function context(params: Promise<{ id: string }>) {
  const auth = await requireRole(["customer", "vendor"]);
  if (auth instanceof Response) return auth;
  const id = parseId((await params).id);
  if (id === null) return notFound();
  return { userId: auth.userId, id };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(params);
  if (ctx instanceof Response) return ctx;
  const enquiry = await getCustomerEnquiry({ userId: ctx.userId }, ctx.id);
  if (!enquiry) return notFound();
  await markThreadRead(ctx.id, "customer", ctx.userId);
  return json(200, { enquiry });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(params);
  if (ctx instanceof Response) return ctx;
  const body = await readObject(request);
  if (!body) return bad("body", "Invalid request body.");

  let act: CustomerAction;
  const offerId = typeof body.offerId === "number" && Number.isSafeInteger(body.offerId) && body.offerId > 0 ? body.offerId : null;
  switch (body.action) {
    case "withdraw":
    case "booked":
      act = { action: body.action };
      break;
    case "accept":
      if (!offerId) return bad("offerId", "Which offer are you accepting?");
      act = { action: "accept", offerId };
      break;
    case "decline": {
      if (!offerId) return bad("offerId", "Which offer are you declining?");
      let message: string | null = null;
      if (body.message !== undefined && body.message !== null && body.message !== "") {
        message = cleanMessageBody(body.message);
        if (!message) return bad("message", "The note can be up to 4000 characters.");
      }
      act = { action: "decline", offerId, message };
      break;
    }
    default:
      return bad("action", "Action must be withdraw, accept, decline or booked.");
  }

  try {
    const status = await customerAct({ userId: ctx.userId }, ctx.userId, ctx.id, act);
    if (status === null) return notFound();
    const enquiry = await getCustomerEnquiry({ userId: ctx.userId }, ctx.id);
    return json(200, { status, enquiry });
  } catch (err) {
    return handleThreadError(err);
  }
}
