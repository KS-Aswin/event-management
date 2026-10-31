import { requireAdmin } from "@/app/api/_lib/auth";
import { adminJson, adminError, readJsonObject, parseReason } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { blockContact, listBlockedContacts, normaliseContact } from "@/lib/admin/ops";

// GET /api/admin/blocked-contacts: every blocked phone / email.
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    return adminJson({ contacts: await listBlockedContacts() });
  } catch (err) {
    return adminError(err);
  }
}

// POST /api/admin/blocked-contacts { value: phone or email, reason }
// Enquiries from a blocked contact are refused with a generic 403.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await readJsonObject(req);
  const contact = normaliseContact(body?.value);
  if (!contact) {
    return adminJson({ error: "Enter a valid 10-digit mobile number or email address.", field: "value" }, 400);
  }
  const reason = parseReason(body?.reason);
  if (!reason) return adminJson({ error: "Please give a reason (at least 3 characters).", field: "reason" }, 400);
  try {
    const row = await blockContact({ actorId: auth.userId, value: contact.value, reason, ip: clientIp(req) });
    return adminJson({ ok: true, contact: row }, 201);
  } catch (err) {
    return adminError(err);
  }
}
