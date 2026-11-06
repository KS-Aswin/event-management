import { NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { findEnquiryByToken, isGuestToken } from "@/lib/enquiry-tracking";

// GET /api/enquiries/track/[token]: a guest's read-only view of their enquiry
// (P2-3): status, vendor, requested units, offers with lines and the message
// thread. The token (uuid from the enquiry response) is the only key; a
// malformed or unknown token is 404. Never cached, never indexed.

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checkRateLimit(`track:ip:${clientIp(request.headers)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests.", code: "RATE_LIMIT" }, { status: 429, headers: HEADERS });
  }
  const { token } = await params;
  const enquiry = isGuestToken(token) ? await findEnquiryByToken(token) : null;
  if (!enquiry) {
    return NextResponse.json({ error: "Enquiry not found.", code: "NOT_FOUND" }, { status: 404, headers: HEADERS });
  }
  return NextResponse.json({ enquiry }, { headers: HEADERS });
}
