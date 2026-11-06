import { requireAdmin } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { decideDocument, DOC_DECISIONS, parseExpiry, type DocDecision } from "@/lib/admin/documents";

// POST /api/admin/documents/[id]/decision
//   { action: "verify" | "reject", reason (required for reject), expiresAt?: "YYYY-MM-DD" | null }
// Audited once, vendor notified in-app. 409 when already handled.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const docId = parseId((await params).id);
  if (docId === null) return adminJson({ error: "Invalid document id." }, 400);
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Invalid request body." }, 400);
  const action = body.action as DocDecision;
  if (!DOC_DECISIONS.includes(action)) return adminJson({ field: "action", error: "Choose verify or reject." }, 400);

  let reason: string | null = null;
  if (action === "reject") {
    reason = parseReason(body.reason);
    if (!reason) return adminJson({ field: "reason", error: "Please give a reason (3-1000 characters)." }, 400);
  } else if (body.reason !== undefined && body.reason !== null && body.reason !== "") {
    reason = parseReason(body.reason);
    if (!reason) return adminJson({ field: "reason", error: "The note must be 3-1000 characters." }, 400);
  }

  let expiresAt: string | null | undefined;
  if (body.expiresAt !== undefined) {
    const e = parseExpiry(body.expiresAt);
    if (e === "invalid") return adminJson({ field: "expiresAt", error: "Enter a valid expiry date." }, 400);
    expiresAt = e;
  }

  try {
    const out = await decideDocument({ actorId: auth.userId, docId, action, reason, expiresAt, ip: clientIp(req) });
    return adminJson({ ok: true, ...out });
  } catch (err) {
    return adminError(err);
  }
}
