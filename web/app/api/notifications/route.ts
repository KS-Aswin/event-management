import { NextResponse } from "next/server";
import { requireRole } from "@/app/api/_lib/auth";
import { listNotifications, markNotificationsRead } from "@/lib/notifications";

// In-app notifications for the signed-in user (P2-13): admin decisions and
// new leads for vendors, offers, messages and booking updates for customers.
// The header bell reads and marks them here. Only the caller's own rows are
// ever read or changed.

const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET /api/notifications?limit=10 -> { items, unread } */
export async function GET(request: Request) {
  const auth = await requireRole(["vendor", "customer", "admin"]);
  if (auth instanceof Response) return auth;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 10);
  const data = await listNotifications(auth.userId, limit);
  return NextResponse.json(data, { headers: NO_STORE });
}

/** POST /api/notifications { ids: number[] } or { all: true } -> marks them read. */
export async function POST(request: Request) {
  const auth = await requireRole(["vendor", "customer", "admin"]);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }
  const b = (body ?? {}) as { ids?: unknown; all?: unknown };
  let ids: number[] | null = null;
  if (b.all !== true) {
    if (
      !Array.isArray(b.ids) ||
      b.ids.length === 0 ||
      b.ids.length > 100 ||
      !b.ids.every((x) => Number.isSafeInteger(x) && (x as number) > 0)
    ) {
      return NextResponse.json({ error: "Send ids (1-100) or all: true." }, { status: 400, headers: NO_STORE });
    }
    ids = b.ids as number[];
  }
  const marked = await markNotificationsRead(auth.userId, ids);
  return NextResponse.json({ marked }, { headers: NO_STORE });
}

/** PATCH /api/notifications: same as POST (PRODUCT_PLAN section 6 lists GET/PATCH). */
export const PATCH = POST;
