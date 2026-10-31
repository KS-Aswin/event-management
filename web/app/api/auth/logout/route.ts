import { NextResponse } from "next/server";
import { destroySessionCookie } from "@/lib/session";
import { rejectCrossSite } from "../_guard";

export async function POST(request: Request) {
  // Logout sends no body, so only the Origin check applies.
  const blocked = rejectCrossSite(request, { requireJson: false });
  if (blocked) return blocked;
  await destroySessionCookie();
  return NextResponse.json({ ok: true });
}
