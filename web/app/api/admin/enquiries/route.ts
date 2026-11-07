import { requireAdmin } from "@/app/api/_lib/auth";
import { adminJson, adminError } from "@/lib/admin/http";
import {
  cleanEnquiryFilters,
  getEnquiryVolume,
  listEnquiries,
  listSpamSignals,
  SPAM_VENDORS,
  SPAM_WINDOW,
} from "@/lib/admin/ops";

// GET /api/admin/enquiries?q=&spam=1&range=24h|7d|30d|all&page= (P1-13):
// recent enquiries with spam and blocked flags, plus volume and spam signals.
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    const [list, volume, spam] = await Promise.all([
      listEnquiries(cleanEnquiryFilters(sp)),
      getEnquiryVolume(),
      listSpamSignals(),
    ]);
    return adminJson({ ...list, volume, spam, spamRule: { vendors: SPAM_VENDORS, window: SPAM_WINDOW } });
  } catch (err) {
    return adminError(err);
  }
}
