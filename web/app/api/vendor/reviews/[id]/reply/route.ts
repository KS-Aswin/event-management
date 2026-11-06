import { requireRole } from "@/app/api/_lib/auth";
import { bad, json, readObject, tooMany } from "@/app/api/_lib/thread-http";
import { parseId } from "@/app/api/_lib/validation";
import { getOwnVendor } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { REPLY_MAX, REPLY_MIN, saveReviewReply } from "@/lib/vendor-reviews";

// The vendor's public reply to a review on its own listing (PRODUCT_PLAN
// P2-11, section 6). POST {body}: the one reply (409 REPLY_EXISTS after
// that). PATCH {body}: edit it within 7 days of first posting (409
// EDIT_WINDOW_CLOSED afterwards). A review on another listing is 403.

async function handle(request: Request, params: Promise<{ id: string }>, mode: "create" | "edit") {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const reviewId = parseId(id);
  if (reviewId === null) return bad("id", "Invalid review id.");
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) return json(403, { error: "This review isn't on your listing.", code: "FORBIDDEN" });
  if (!checkRateLimit(`review-reply:u:${auth.userId}`, 20, 10 * 60_000)) return tooMany();

  const body = await readObject(request);
  if (!body) return bad("body", "Invalid request body.");
  if (typeof body.body !== "string") return bad("body", "Write your reply.");
  const text = body.body.trim();
  if (text.length < REPLY_MIN) return bad("body", "Write your reply.");
  if (text.length > REPLY_MAX) return bad("body", `Replies can be up to ${REPLY_MAX} characters.`);

  const r = await saveReviewReply(vendor.id, reviewId, text, mode);
  if (!r.ok) return json(r.status, { error: r.error, code: r.code });
  return json(mode === "create" ? 201 : 200, { reply: r.reply });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, "create");
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, "edit");
}
