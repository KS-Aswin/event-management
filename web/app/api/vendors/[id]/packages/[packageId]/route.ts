import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { deletePackage } from "@/lib/vendor-content";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; packageId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { packageId } = await params;
  const pid = parseInt(packageId, 10);
  if (Number.isNaN(pid)) {
    return NextResponse.json({ error: "Invalid package id." }, { status: 400 });
  }
  // Ownership is enforced inside the DELETE (joined to vendors.owner_id).
  const ok = await deletePackage(pid, session.userId);
  if (!ok) {
    return NextResponse.json({ error: "Package not found, or you don't own it." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
