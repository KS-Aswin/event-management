import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// POST /api/events: public analytics beacon (P1-12). Sent with
// navigator.sendBeacon from the public vendor profile (VendorBeacon).
//
// Body: { vendorId: number, kind: 'profile_view' | 'whatsapp_click' | 'phone_click' }
// ('phone_click' is stored as the table's 'phone_reveal' kind.)
//
// Rules:
//  - only approved, published vendors are counted;
//  - views and clicks by the vendor's owner and by admins are ignored;
//  - a profile view is counted at most once per browser session per vendor:
//    an anonymous session cookie (vela_sid, no Max-Age so it ends with the
//    browser session) is hashed into vendor_events.session_key and a partial
//    unique index (migration 006) makes the insert idempotent;
//  - rate-limited per IP and per session.
// Always answers small JSON { ok, counted } (sendBeacon ignores the body).

const SID_COOKIE = "vela_sid";
const KINDS: Record<string, "profile_view" | "whatsapp_click" | "phone_reveal"> = {
  profile_view: "profile_view",
  whatsapp_click: "whatsapp_click",
  phone_click: "phone_reveal",
  phone_reveal: "phone_reveal",
};
const MAX_BODY = 512;
const MAX_INT4 = 2147483647;
const NO_STORE = { "Cache-Control": "no-store" };

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // sendBeacon from same origin may omit it; server-to-server tests too
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return reply({ ok: false, error: "Forbidden" }, 403);
  if (!checkRateLimit(`events:ip:${clientIp(req.headers)}`, 120, 60_000)) {
    return reply({ ok: false, error: "Too many requests" }, 429);
  }

  let body: { vendorId?: unknown; kind?: unknown } | null = null;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return reply({ ok: false, error: "Too large" }, 413);
    const parsed = JSON.parse(text);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    body = null;
  }
  const vendorId = Number(body?.vendorId);
  const kind = typeof body?.kind === "string" ? KINDS[body.kind] : undefined;
  if (!body || !Number.isInteger(vendorId) || vendorId < 1 || vendorId > MAX_INT4 || !kind) {
    return reply({ ok: false, error: "Invalid event" }, 400);
  }

  const jar = await cookies();
  let sid = jar.get(SID_COOKIE)?.value;
  if (!sid || !/^[A-Za-z0-9_-]{16,64}$/.test(sid)) {
    sid = randomBytes(18).toString("base64url");
    jar.set(SID_COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // no maxAge: a browser-session cookie
    });
  }
  if (!checkRateLimit(`events:sid:${sid}`, 60, 60_000)) {
    return reply({ ok: false, error: "Too many requests" }, 429);
  }

  try {
    const { rows } = await pool.query<{ owner_id: number | null; district_id: number | null }>(
      `SELECT owner_id, district_id FROM vendors
        WHERE id = $1 AND status = 'approved' AND published`,
      [vendorId]
    );
    const vendor = rows[0];
    if (!vendor) return reply({ ok: true, counted: false });

    const session = await getSession();
    if (session && (session.role === "admin" || session.userId === vendor.owner_id)) {
      return reply({ ok: true, counted: false });
    }

    const sessionKey = createHash("sha256").update(`${sid}:${vendorId}`).digest("base64url").slice(0, 32);
    if (kind === "profile_view") {
      const r = await pool.query(
        `INSERT INTO vendor_events (vendor_id, kind, district_id, session_key)
         VALUES ($1, 'profile_view', $2, $3)
         ON CONFLICT (vendor_id, session_key) WHERE kind = 'profile_view' AND session_key IS NOT NULL DO NOTHING`,
        [vendorId, vendor.district_id, sessionKey]
      );
      return reply({ ok: true, counted: (r.rowCount ?? 0) > 0 });
    }
    // Clicks: no dedupe, but at most 5 per session, vendor and kind per 10 minutes.
    if (!checkRateLimit(`events:click:${sessionKey}:${kind}`, 5, 10 * 60_000)) {
      return reply({ ok: true, counted: false });
    }
    await pool.query(
      `INSERT INTO vendor_events (vendor_id, kind, district_id, session_key) VALUES ($1, $2, $3, $4)`,
      [vendorId, kind, vendor.district_id, sessionKey]
    );
    return reply({ ok: true, counted: true });
  } catch (err) {
    console.error("events beacon error", err);
    return reply({ ok: false, error: "Something went wrong" }, 500);
  }
}
