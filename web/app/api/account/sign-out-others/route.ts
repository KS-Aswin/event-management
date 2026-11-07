import { NextResponse } from "next/server";
import { getLiveSession } from "../../_lib/auth";
import { endOtherSessions } from "../_security";

const NO_STORE = { "Cache-Control": "private, no-store" };

// POST /api/account/sign-out-others (QA-081): "Sign out of other devices".
// Ends every other session of this account (a lost phone, a shared
// computer, a copied cookie) and keeps this device signed in.
// 200 { ok } | 401
export async function POST() {
  const session = await getLiveSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE });
  const ok = await endOtherSessions(session);
  if (!ok) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
