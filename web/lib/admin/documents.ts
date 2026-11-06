import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db";
import { currentStorageDriver, getStorage } from "@/lib/storage";
import { audit } from "./audit";
import { notify } from "./notify";
import { HttpError, withTransaction, type TxClient } from "./tx";
import {
  DOC_TYPE_LABEL,
  DOC_TYPES,
  MAX_DOC_BYTES,
  type DocDisplayStatus,
  type DocTab,
  type DocType,
} from "@/app/vendor/documents/doc-meta";

// Vendor documents and verification (PRODUCT_PLAN P1-10).
//
// Files live under the PRIVATE storage prefix (private/vendor-docs/<vendor>/),
// which app/media/[...key] never serves (isPrivateKey -> 404). The only way
// to read one is GET /api/admin/documents/[id]/file (requireAdmin).
// "Expired" is computed from expires_at (India date), never stored, and does
// not change whether the listing is public.

export const MAX_ACTIVE_DOCS = 20;

/** Today's calendar date in India (YYYY-MM-DD). */
export function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

const TODAY_SQL = "(now() AT TIME ZONE 'Asia/Kolkata')::date";
/** Expression for the computed display status of alias d. */
const DISPLAY_SQL = `CASE WHEN d.status IN ('pending','verified') AND d.expires_at IS NOT NULL AND d.expires_at < ${TODAY_SQL}
  THEN 'expired' ELSE d.status END`;

/** Admin queue tab -> WHERE fragment on alias d. */
const TAB_SQL: Record<DocTab, string> = {
  pending: "d.status = 'pending'",
  verified: `d.status = 'verified' AND (d.expires_at IS NULL OR d.expires_at >= ${TODAY_SQL})`,
  rejected: "d.status = 'rejected'",
  expired: `d.status = 'verified' AND d.expires_at IS NOT NULL AND d.expires_at < ${TODAY_SQL}`,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);
}

/** Detects PDF / JPEG / PNG from the first bytes; the browser's mime is not trusted. */
export function sniffDocument(buf: Uint8Array): { mime: string; ext: string } | null {
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) {
    return { mime: "application/pdf", ext: "pdf" }; // %PDF-
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) return { mime: "image/png", ext: "png" };
  return null;
}

/**
 * Optional expiry date: "" / null / undefined -> null; a real calendar date
 * "YYYY-MM-DD" between 2000 and 2100 -> that string; anything else "invalid".
 */
export function parseExpiry(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "invalid";
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "invalid";
  if (y < 2000 || y > 2100) return "invalid";
  return v;
}

/** Optional document number: trimmed, upper-cased, [A-Z0-9 /-] up to 40 chars. */
export function parseDocNumber(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return "invalid";
  const s = v.trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;
  return /^[A-Z0-9][A-Z0-9 /.-]{0,39}$/.test(s) ? s : "invalid";
}

// ---------------------------------------------------------------------------
// Vendor side
// ---------------------------------------------------------------------------

export interface VendorDocument {
  id: number;
  docType: string;
  typeLabel: string;
  number: string | null;
  status: DocDisplayStatus;
  expiresAt: string | null;
  /** Reject reason (rejected only). */
  reason: string | null;
  mime: string;
  bytes: number;
  createdAt: string;
  reviewedAt: string | null;
  canDelete: boolean;
}

interface DocRow {
  id: number;
  vendor_id: number;
  doc_type: string;
  number: string | null;
  storage_driver: string;
  storage_key: string;
  mime: string;
  bytes: number;
  status: string;
  display_status: DocDisplayStatus;
  expires_at: string | null;
  note: string | null;
  reviewed_by: number | null;
  reviewed_at: Date | null;
  created_at: Date;
}

const ROW_COLUMNS = `d.id, d.vendor_id, d.doc_type, d.number, d.storage_driver, d.storage_key, d.mime, d.bytes,
  d.status, ${DISPLAY_SQL} AS display_status, to_char(d.expires_at, 'YYYY-MM-DD') AS expires_at, d.note,
  d.reviewed_by, d.reviewed_at, d.created_at`;

function toVendorDoc(r: DocRow): VendorDocument {
  return {
    id: r.id,
    docType: r.doc_type,
    typeLabel: DOC_TYPE_LABEL[r.doc_type] ?? r.doc_type,
    number: r.number,
    status: r.display_status,
    expiresAt: r.expires_at,
    reason: r.status === "rejected" ? r.note : null,
    mime: r.mime,
    bytes: r.bytes,
    createdAt: new Date(r.created_at).toISOString(),
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
    canDelete: r.status === "pending" || r.status === "rejected",
  };
}

/** The vendor's own documents, newest first. */
export async function listOwnDocuments(vendorId: number): Promise<VendorDocument[]> {
  const r = await pool.query<DocRow>(
    `SELECT ${ROW_COLUMNS} FROM vendor_documents d WHERE d.vendor_id = $1 ORDER BY d.created_at DESC, d.id DESC`,
    [vendorId]
  );
  return r.rows.map(toVendorDoc);
}

/** How many documents the vendor has uploaded (any status). */
export async function countOwnDocuments(vendorId: number): Promise<number> {
  const r = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM vendor_documents WHERE vendor_id = $1", [vendorId]);
  return r.rows[0]?.n ?? 0;
}

/** Stores the file privately and inserts a pending row. Throws HttpError for limits. */
export async function createOwnDocument(input: {
  vendorId: number;
  docType: DocType;
  number: string | null;
  expiresAt: string | null;
  data: Uint8Array;
}): Promise<VendorDocument> {
  if (input.data.byteLength === 0) throw new HttpError(400, "The file is empty.", "VALIDATION");
  if (input.data.byteLength > MAX_DOC_BYTES) throw new HttpError(413, "The file is larger than 4 MB.", "TOO_LARGE");
  const kind = sniffDocument(input.data);
  if (!kind) throw new HttpError(415, "Upload a PDF, JPEG or PNG file.", "UNSUPPORTED_TYPE");

  const active = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM vendor_documents WHERE vendor_id = $1 AND status <> 'rejected'",
    [input.vendorId]
  );
  if (active.rows[0].n >= MAX_ACTIVE_DOCS) {
    throw new HttpError(409, `You can keep up to ${MAX_ACTIVE_DOCS} documents. Delete an old one first.`, "LIMIT");
  }

  const driver = currentStorageDriver();
  const storage = getStorage(driver);
  const key = `private/vendor-docs/${input.vendorId}/${randomUUID()}.${kind.ext}`;
  await storage.put(key, input.data, { contentType: kind.mime, cacheControl: "private, no-store" });
  try {
    const r = await pool.query<DocRow>(
      `INSERT INTO vendor_documents AS d (vendor_id, doc_type, number, storage_driver, storage_key, mime, bytes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)
       RETURNING ${ROW_COLUMNS}`,
      [input.vendorId, input.docType, input.number, driver, key, kind.mime, input.data.byteLength, input.expiresAt]
    );
    return toVendorDoc(r.rows[0]);
  } catch (err) {
    await storage.delete(key).catch(() => {});
    throw err;
  }
}

/** Deletes a pending or rejected document the vendor owns (404 otherwise, 409 once verified). */
export async function deleteOwnDocument(vendorId: number, docId: number): Promise<void> {
  const del = await pool.query<{ storage_driver: string; storage_key: string }>(
    `DELETE FROM vendor_documents WHERE id = $1 AND vendor_id = $2 AND status IN ('pending', 'rejected')
     RETURNING storage_driver, storage_key`,
    [docId, vendorId]
  );
  const row = del.rows[0];
  if (!row) {
    const exists = await pool.query("SELECT 1 FROM vendor_documents WHERE id = $1 AND vendor_id = $2", [docId, vendorId]);
    if (exists.rowCount) {
      throw new HttpError(409, "A verified document can't be deleted. Upload a newer one instead.", "VERIFIED");
    }
    throw new HttpError(404, "Document not found.", "NOT_FOUND");
  }
  try {
    await getStorage(row.storage_driver).delete(row.storage_key);
  } catch (err) {
    console.error("vendor document file delete", err);
  }
}

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

export interface AdminDocument extends VendorDocument {
  /** Raw stored status (pending / verified / rejected). */
  storedStatus: string;
  note: string | null;
  vendor: { id: number; name: string; status: string; district: string | null; isVerified: boolean };
  reviewer: string | null;
  fileUrl: string;
}

export interface DocumentQueue {
  tab: DocTab;
  items: AdminDocument[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<DocTab, number>;
  vendor: { id: number; name: string } | null;
}

const PAGE_SIZE = 30;

/** Admin queue for one tab, optionally for one vendor. Oldest first for pending. */
export async function listDocumentQueue(opts: { tab: DocTab; vendorId?: number | null; page?: number }): Promise<DocumentQueue> {
  const page = Math.min(10_000, Math.max(1, Math.floor(opts.page ?? 1)));
  const vendorId = opts.vendorId ?? null;
  const vendorWhere = "($1::int IS NULL OR d.vendor_id = $1)";
  const order = opts.tab === "pending" ? "d.created_at ASC, d.id ASC" : "COALESCE(d.reviewed_at, d.created_at) DESC, d.id DESC";
  const [items, counts, vendor] = await Promise.all([
    pool.query<
      DocRow & { vendor_name: string; vendor_status: string; district: string | null; verified_at: Date | null; reviewer: string | null; total: number }
    >(
      `SELECT ${ROW_COLUMNS}, v.name AS vendor_name, v.status::text AS vendor_status, dist.name AS district,
              v.verified_at, u.name AS reviewer, count(*) OVER ()::int AS total
         FROM vendor_documents d
         JOIN vendors v ON v.id = d.vendor_id
         LEFT JOIN districts dist ON dist.id = v.district_id
         LEFT JOIN users u ON u.id = d.reviewed_by
        WHERE ${TAB_SQL[opts.tab]} AND ${vendorWhere}
        ORDER BY ${order}
        LIMIT ${PAGE_SIZE} OFFSET $2`,
      [vendorId, (page - 1) * PAGE_SIZE]
    ),
    pool.query<Record<DocTab, number>>(
      `SELECT ${(Object.keys(TAB_SQL) as DocTab[])
        .map((t) => `count(*) FILTER (WHERE ${TAB_SQL[t]})::int AS ${t}`)
        .join(", ")}
         FROM vendor_documents d WHERE ${vendorWhere}`,
      [vendorId]
    ),
    vendorId
      ? pool.query<{ id: number; name: string }>("SELECT id, name FROM vendors WHERE id = $1", [vendorId])
      : Promise.resolve(null),
  ]);
  return {
    tab: opts.tab,
    page,
    pageSize: PAGE_SIZE,
    total: items.rows[0]?.total ?? 0,
    counts: counts.rows[0],
    vendor: vendor?.rows[0] ?? null,
    items: items.rows.map((r) => ({
      ...toVendorDoc(r),
      storedStatus: r.status,
      note: r.note,
      vendor: {
        id: r.vendor_id,
        name: r.vendor_name,
        status: r.vendor_status,
        district: r.district,
        isVerified: !!r.verified_at,
      },
      reviewer: r.reviewer,
      fileUrl: `/api/admin/documents/${r.id}/file`,
    })),
  };
}

/** Storage location of one document for the admin file route; null when missing. */
export async function getDocumentFile(
  docId: number
): Promise<{ driver: string; key: string; mime: string; docType: string; vendorId: number } | null> {
  const r = await pool.query<{ storage_driver: string; storage_key: string; mime: string; doc_type: string; vendor_id: number }>(
    "SELECT storage_driver, storage_key, mime, doc_type, vendor_id FROM vendor_documents WHERE id = $1",
    [docId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { driver: row.storage_driver, key: row.storage_key, mime: row.mime, docType: row.doc_type, vendorId: row.vendor_id };
}

export type DocDecision = "verify" | "reject";
export const DOC_DECISIONS: readonly DocDecision[] = ["verify", "reject"];

/**
 * Verify or reject one document: one UPDATE, exactly one audit row and an
 * in-app notification for the vendor owner, all in one transaction.
 * verify: allowed from pending, rejected, or an expired verified document
 * (re-verify with a new expiry); 409 when it is already verified and valid.
 * reject: needs a reason; 409 when already rejected.
 */
export async function decideDocument(params: {
  actorId: number;
  docId: number;
  action: DocDecision;
  reason: string | null;
  /** undefined = keep the current expiry; null = clear; string = set. */
  expiresAt?: string | null;
  ip?: string | null;
}) {
  const { actorId, docId, action, reason, ip } = params;
  return withTransaction(async (client) => {
    const r = await client.query<DocRow & { owner_id: number | null }>(
      `SELECT ${ROW_COLUMNS}, v.owner_id
         FROM vendor_documents d JOIN vendors v ON v.id = d.vendor_id
        WHERE d.id = $1 FOR UPDATE OF d`,
      [docId]
    );
    const d = r.rows[0];
    if (!d) throw new HttpError(404, "Document not found.", "NOT_FOUND");
    const expiresAt = params.expiresAt === undefined ? d.expires_at : params.expiresAt;

    if (action === "verify") {
      if (d.status === "verified" && d.display_status !== "expired" && params.expiresAt === undefined) {
        throw new HttpError(409, "This document is already verified.", "ALREADY_HANDLED");
      }
      if (expiresAt && expiresAt < todayIst()) {
        throw new HttpError(400, "The expiry date has passed. Reject it or enter the new expiry date.", "EXPIRED");
      }
    } else if (d.status === "rejected") {
      throw new HttpError(409, "This document was already rejected.", "ALREADY_HANDLED");
    }

    const status = action === "verify" ? "verified" : "rejected";
    const upd = await client.query<{ status: string; expires_at: string | null; note: string | null }>(
      `UPDATE vendor_documents SET status = $2, note = $3, expires_at = $4::date, reviewed_by = $5, reviewed_at = now()
        WHERE id = $1
        RETURNING status, to_char(expires_at, 'YYYY-MM-DD') AS expires_at, note`,
      [docId, status, action === "reject" ? reason : null, expiresAt, actorId]
    );
    const after = upd.rows[0];
    const label = DOC_TYPE_LABEL[d.doc_type] ?? "document";
    if (action === "verify") {
      await notify(client, d.owner_id, "document.verified", `Your ${label} is verified`, null, "/vendor/documents", { documentId: docId });
    } else {
      await notify(client, d.owner_id, "document.rejected", `Your ${label} was not accepted`, reason, "/vendor/documents", {
        documentId: docId,
      });
    }
    await audit(client, {
      actorId,
      action: action === "verify" ? "document.verify" : "document.reject",
      entityType: "vendor_document",
      entityId: docId,
      before: { status: d.status, expires_at: d.expires_at, note: d.note, vendor_id: d.vendor_id, doc_type: d.doc_type },
      after: { status: after.status, expires_at: after.expires_at, note: after.note },
      reason: action === "reject" ? reason : reason || null,
      ip,
    });
    return { id: docId, status: after.status, expiresAt: after.expires_at, vendorId: d.vendor_id };
  });
}

/**
 * "Verified business" rule (P1-10): the vendor has at least one verified
 * document that has not expired. Called by setVendorVerified before it sets
 * the badge.
 */
export async function hasVerifiedDocument(client: TxClient, vendorId: number): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM vendor_documents
      WHERE vendor_id = $1 AND status = 'verified' AND (expires_at IS NULL OR expires_at >= ${TODAY_SQL})
      LIMIT 1`,
    [vendorId]
  );
  return (r.rowCount ?? 0) > 0;
}
