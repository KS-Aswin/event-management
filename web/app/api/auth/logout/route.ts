import { NextResponse } from "next/server";
import { destroySessionCookie, getSessionWithToken } from "@/lib/session";
import { revokeSessionToken } from "@/lib/session-revocation";
import { rejectCrossSite } from "../_guard";

// POST /api/auth/logout: signs THIS device out. The token is also revoked on
// the server (QA-081), so a copied cookie stops working at once; other
// devices stay signed in ("Sign out of other devices" in Settings ends
// those: POST /api/account/sessions).
export async function POST(request: Request) {
  // Logout sends no body, so only the Origin check applies.
  const blocked = rejectCrossSite(request, { requireJson: false });
  if (blocked) return blocked;
  const current = await getSessionWithToken();
  if (current) {
    try {
      await revokeSessionToken(current.token, current.session.userId, current.exp);
    } catch (err) {
      // Still clear the cookie; the token expires on its own.
      console.error("logout: could not revoke the session token", err);
    }
  }
  await destroySessionCookie();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
