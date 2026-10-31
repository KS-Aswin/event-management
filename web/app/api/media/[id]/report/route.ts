import { NextResponse } from "next/server";
import { reportMedia } from "@/lib/admin/moderation";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLiveSession } from "../../../_lib/auth";
import { parseId } from "../../../_lib/validation";

const REASON_MAX = 500;

// "Report photo" from the public lightbox (PRODUCT_PLAN 4.5). Signed-in
// users only, one open report per person per asset; two people reporting
// sends the asset back to admin review (off public pages).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in to report a photo." }, { status: 401 });
  }
  const mediaId = parseId((await params).id);
  if (mediaId === null) {
    return NextResponse.json({ error: "Invalid media id." }, { status: 400 });
  }
  if (!checkRateLimit(`mreport:u:${session.userId}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many reports. Please try again later." }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { reason } = (body ?? {}) as Record<string, unknown>;
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > REASON_MAX) {
    return NextResponse.json(
      { field: "reason", error: `Please say briefly what is wrong (3-${REASON_MAX} characters).` },
      { status: 400 }
    );
  }
  const { result } = await reportMedia({ mediaId, reporterId: session.userId, reason: reason.trim() });
  if (result === "not_found") return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  if (result === "own_media") {
    return NextResponse.json({ error: "You can't report your own photos." }, { status: 400 });
  }
  if (result === "already_reported") {
    return NextResponse.json({ error: "You've already reported this photo." }, { status: 409 });
  }
  return NextResponse.json({ reported: true }, { status: 201 });
}
