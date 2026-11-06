import { guestTokenFromPath, isGuestToken } from "@/lib/enquiry-tracking";

/**
 * The guest enquiry token from ?enquiry= (or a next=/enquiry/<token>), or "".
 * Sign-in / sign-up send it so that enquiry joins the account (QA-003).
 */
export function enquiryTokenFrom(params: Record<string, string | string[] | undefined>, next: string): string {
  const raw = params.enquiry;
  if (isGuestToken(raw)) return raw.toLowerCase();
  return guestTokenFromPath(next)?.toLowerCase() ?? "";
}
