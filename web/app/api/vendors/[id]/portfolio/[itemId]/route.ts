import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { deletePortfolioItem } from "@/lib/vendor-content";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { itemId } = await params;
  const iid = parseInt(itemId, 10);
  if (Number.isNaN(iid)) {
    return NextResponse.json({ error: "Invalid item id." }, { status: 400 });
  }
  const ok = await deletePortfolioItem(iid, session.userId);
  if (!ok) {
    return NextResponse.json({ error: "Photo not found, or you don't own it." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
