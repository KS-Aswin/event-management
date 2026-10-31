import { NextResponse } from "next/server";
import { getVendorEntitlements } from "@/lib/entitlements";
import { apiError, cleanText, optionalId } from "./http";
import {
  findAsset,
  getMediaUsage,
  serviceBelongsTo,
  type AlbumFields,
  type VendorRef,
} from "./repo";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates an album payload (camelCase from the client). Returns the
 * fields to write, or an error response. `creating` makes title required.
 */
export async function parseAlbumInput(
  vendor: VendorRef,
  body: Record<string, unknown>,
  creating: boolean
): Promise<AlbumFields | NextResponse> {
  const f: AlbumFields = {};
  if (body.title !== undefined || creating) {
    const t = cleanText(body.title, 120);
    if (!t) return apiError(400, "Give the album a title (up to 120 characters).", "VALIDATION");
    f.title = t;
  }
  if (body.description !== undefined) {
    const d = cleanText(body.description, 1000);
    if (d === null) return apiError(400, "Description can be at most 1000 characters.", "VALIDATION");
    f.description = d;
  }
  if (body.venueName !== undefined) {
    const v = cleanText(body.venueName, 160);
    if (v === null) return apiError(400, "Venue name is too long.", "VALIDATION");
    f.venue_name = v || null;
  }
  if (body.eventDate !== undefined) {
    if (body.eventDate === null || body.eventDate === "") f.event_date = null;
    else if (typeof body.eventDate === "string" && DATE_RE.test(body.eventDate) && !Number.isNaN(Date.parse(body.eventDate))) {
      f.event_date = body.eventDate;
    } else return apiError(400, "Event date must be YYYY-MM-DD.", "VALIDATION");
  }
  for (const [key, col] of [
    ["eventTypeId", "event_type_id"],
    ["districtId", "district_id"],
  ] as const) {
    const v = optionalId(body[key]);
    if (v === "invalid") return apiError(400, `Invalid ${key}.`, "VALIDATION");
    if (v !== undefined) f[col] = v;
  }
  const serviceId = optionalId(body.serviceId);
  if (serviceId === "invalid") return apiError(400, "Invalid offering.", "VALIDATION");
  if (typeof serviceId === "number" && !(await serviceBelongsTo(vendor.id, serviceId))) {
    return apiError(404, "Offering not found.", "NOT_FOUND");
  }
  if (serviceId !== undefined) f.service_id = serviceId;
  const cover = optionalId(body.coverMediaId);
  if (cover === "invalid") return apiError(400, "Invalid cover.", "VALIDATION");
  if (typeof cover === "number") {
    const a = await findAsset(vendor.id, cover);
    if (!a || a.kind !== "image") return apiError(404, "Cover photo not found.", "NOT_FOUND");
  }
  if (cover !== undefined) f.cover_media_id = cover;
  if (body.consentConfirmed !== undefined) {
    if (typeof body.consentConfirmed !== "boolean") return apiError(400, "consentConfirmed must be true or false.", "VALIDATION");
    f.consent_confirmed = body.consentConfirmed;
  }
  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") return apiError(400, "published must be true or false.", "VALIDATION");
    f.published = body.published;
  }
  if (body.sortOrder !== undefined) {
    const n = body.sortOrder;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 1_000_000) {
      return apiError(400, "Invalid sort order.", "VALIDATION");
    }
    f.sort_order = n;
  }
  return f;
}

export async function albumLimitReached(vendor: VendorRef): Promise<NextResponse | null> {
  const [ent, usage] = await Promise.all([getVendorEntitlements(vendor.id), getMediaUsage(vendor.id)]);
  if (ent.maxAlbums !== null && usage.albums >= ent.maxAlbums) {
    return apiError(402, "You've reached your plan's album limit.", "PLAN_LIMIT", { limit: "albums", max: ent.maxAlbums });
  }
  return null;
}

/** Maps FK violations (unknown district / event type) to a 400. */
export function albumDbError(err: unknown): NextResponse {
  const code = (err as { code?: string }).code;
  if (code === "23503") return apiError(400, "Unknown district or event type.", "VALIDATION");
  if (code === "23514") return apiError(400, "Invalid album details.", "VALIDATION");
  throw err;
}
