// Pure constants shared by the vendor and admin document screens and by
// lib/admin/documents.ts (P1-10). No server imports: client components use it.

/** Document types a vendor can upload (vendor_documents.doc_type; "aadhaar" is not offered). */
export const DOC_TYPES = ["gst", "trade_licence", "fssai", "pan", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<string, string> = {
  gst: "GSTIN certificate",
  trade_licence: "Trade licence",
  fssai: "FSSAI licence",
  pan: "PAN card",
  aadhaar: "Aadhaar",
  other: "Other document",
};

/** Hint under the type picker in the upload form. */
export const DOC_TYPE_HINT: Record<DocType, string> = {
  gst: "GST registration certificate. Number: 15-character GSTIN.",
  trade_licence: "Licence from your panchayat or municipality.",
  fssai: "Needed for caterers and food stalls. Add the expiry date.",
  pan: "Business or proprietor PAN card.",
  other: "Any other proof that your business is registered.",
};

/**
 * What the vendor and admin see. "expired" is computed (expires_at before
 * today, India time) for pending and verified documents; it never changes
 * the listing's visibility.
 */
export type DocDisplayStatus = "pending" | "verified" | "rejected" | "expired";

export const DOC_STATUS_LABEL: Record<DocDisplayStatus, string> = {
  pending: "Waiting for review",
  verified: "Verified",
  rejected: "Not accepted",
  expired: "Licence expired",
};

export const DOC_STATUS_CLASS: Record<DocDisplayStatus, string> = {
  pending: "bg-[#fdf3d6] text-gold-ink",
  verified: "bg-accent-tint text-accent-hover",
  rejected: "bg-danger-tint text-danger",
  expired: "bg-danger-tint text-danger",
};

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const DOC_ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

/** Admin queue tabs. */
export const DOC_TABS = ["pending", "verified", "rejected", "expired"] as const;
export type DocTab = (typeof DOC_TABS)[number];

export function parseDocTab(v: unknown): DocTab {
  return typeof v === "string" && (DOC_TABS as readonly string[]).includes(v) ? (v as DocTab) : "pending";
}

/** "2027-03-31" -> "31 Mar 2027" (dates are plain calendar dates). */
export function formatDocDate(ymd: string | null): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
