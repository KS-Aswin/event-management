import { requireAdmin } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { dismissReviewReport } from "@/lib/admin/moderation";

// POST /api/admin/reports/[id]/dismiss {note?, scope?: "report"|"review"}:
// the review stays up. scope "review" dismisses every open report on the
// same review in one action. 409 if the report was already handled.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const reportId = parseId((await params).id);
  if (reportId === null) return adminJson({ error: "Invalid report id." }, 400);
  const body = (await readJsonObject(req)) ?? {};
  const scope = body.scope === "review" ? "review" : "report";
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null && body.note !== "") {
    note = parseReason(body.note);
    if (!note) return adminJson({ field: "note", error: "The note must be 3-1000 characters." }, 400);
  }
  try {
    const out = await dismissReviewReport({ actorId: auth.userId, reportId, scope, note, ip: clientIp(req) });
    return adminJson({ ok: true, ...out });
  } catch (err) {
    return adminError(err);
  }
}
