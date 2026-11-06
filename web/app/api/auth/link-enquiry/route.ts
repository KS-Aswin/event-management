import { NextResponse } from "next/server";
import { requireRole } from "../../_lib/auth";
import { rejectCrossSite } from "../_guard";
import { isGuestToken, linkGuestEnquiryByToken } from "@/lib/enquiry-tracking";
import { pool } from "@/lib/db";

const NO_STORE = { "Cache-Control": "private, no-store" };

// POST /api/auth/link-enquiry { token }: a signed-in customer adds the guest
// enquiry they hold the private tracking token for to their account
// (QA-003). The token is the proof of ownership; the email is not checked.
// 200 { enquiryId } | 404 when the token is unknown or already in an account.
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const auth = await requireRole("customer");
  if (auth instanceof Response) return auth;

  let token: unknown;
  try {
    token = ((await request.json()) as Record<string, unknown> | null)?.token;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }
  if (!isGuestToken(token)) {
    return NextResponse.json({ error: "That enquiry link isn't valid." }, { status: 400, headers: NO_STORE });
  }
  const enquiryId =
    (await linkGuestEnquiryByToken({ id: auth.userId, role: auth.role }, token)) ??
    // Already in this account (a second click): still a success.
    (
      await pool.query<{ id: number }>("SELECT id FROM quote_requests WHERE guest_token = $1::uuid AND customer_id = $2", [
        token.toLowerCase(),
        auth.userId,
      ])
    ).rows[0]?.id ??
    null;
  if (!enquiryId) {
    return NextResponse.json(
      { error: "This enquiry can't be added. It may already be in an account.", code: "NOT_LINKABLE" },
      { status: 404, headers: NO_STORE }
    );
  }
  return NextResponse.json({ enquiryId, redirectTo: `/my/enquiries/${enquiryId}` }, { headers: NO_STORE });
}
