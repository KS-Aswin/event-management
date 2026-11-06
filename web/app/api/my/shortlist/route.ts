import { requireRole } from "@/app/api/_lib/auth";
import { json, bad, readObject, tooMany } from "@/app/api/_lib/thread-http";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  SHORTLIST_LIMITS,
  addToShortlist,
  listShortlist,
  mergeShortlist,
  parseNote,
  parseVendorId,
  removeFromShortlist,
  setShortlistNote,
  shortlistCount,
} from "@/lib/shortlist";

// /api/my/shortlist (PRODUCT_PLAN P2-9): the signed-in customer's saved
// vendors with private notes. Customers only (vendors and admins get 403).
//   GET                               -> { items, count }
//   POST   { vendorId, note? }        -> 201 added / 200 already saved
//   POST   { vendorIds: number[] }    -> guest localStorage merge after login
//   PATCH  { vendorId, note }         -> note set or cleared (null / "")
//   DELETE ?vendorId= (or JSON body)  -> removed (idempotent)

const WRITES_PER_MINUTE = 60;

async function customer() {
  return requireRole("customer");
}

function limited(userId: number) {
  return !checkRateLimit(`shortlist:${userId}`, WRITES_PER_MINUTE, 60_000);
}

const NOTE_ERROR = `Notes can be up to ${SHORTLIST_LIMITS.note} characters.`;

export async function GET() {
  const auth = await customer();
  if (auth instanceof Response) return auth;
  const items = await listShortlist(auth.userId);
  return json(200, { items, count: items.length });
}

export async function POST(request: Request) {
  const auth = await customer();
  if (auth instanceof Response) return auth;
  if (limited(auth.userId)) return tooMany();
  const body = await readObject(request);
  if (!body) return bad("body", "Send a JSON object.");

  if (body.vendorIds !== undefined) {
    const raw = body.vendorIds;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > SHORTLIST_LIMITS.mergeBatch) {
      return bad("vendorIds", `Send between 1 and ${SHORTLIST_LIMITS.mergeBatch} vendor ids.`);
    }
    const ids: number[] = [];
    for (const v of raw) {
      const id = parseVendorId(v);
      if (id === null) return bad("vendorIds", "Every vendor id must be a positive whole number.");
      if (!ids.includes(id)) ids.push(id);
    }
    const r = await mergeShortlist(auth.userId, ids);
    return json(200, { ...r, count: await shortlistCount(auth.userId) });
  }

  const vendorId = parseVendorId(body.vendorId);
  if (vendorId === null) return bad("vendorId", "Choose a vendor.");
  const note = parseNote(body.note);
  if (note === false) return bad("note", NOTE_ERROR);
  const r = await addToShortlist(auth.userId, vendorId, note);
  if (!r.ok) return json(r.status, { error: r.error, code: r.code });
  return json(r.added ? 201 : 200, { saved: true, added: r.added, count: await shortlistCount(auth.userId) });
}

export async function PATCH(request: Request) {
  const auth = await customer();
  if (auth instanceof Response) return auth;
  if (limited(auth.userId)) return tooMany();
  const body = await readObject(request);
  if (!body) return bad("body", "Send a JSON object.");
  const vendorId = parseVendorId(body.vendorId);
  if (vendorId === null) return bad("vendorId", "Choose a vendor.");
  if (body.note === undefined) return bad("note", "Send the note (null to clear it).");
  const note = parseNote(body.note);
  if (note === false || note === undefined) return bad("note", NOTE_ERROR);
  if (!(await setShortlistNote(auth.userId, vendorId, note))) {
    return json(404, { error: "That vendor isn't on your shortlist.", code: "NOT_FOUND" });
  }
  return json(200, { vendorId, note });
}

export async function DELETE(request: Request) {
  const auth = await customer();
  if (auth instanceof Response) return auth;
  if (limited(auth.userId)) return tooMany();
  let raw: unknown = new URL(request.url).searchParams.get("vendorId");
  if (raw === null) raw = (await readObject(request))?.vendorId;
  const vendorId = parseVendorId(raw);
  if (vendorId === null) return bad("vendorId", "Choose a vendor.");
  const removed = await removeFromShortlist(auth.userId, vendorId);
  return json(200, { removed, count: await shortlistCount(auth.userId) });
}
