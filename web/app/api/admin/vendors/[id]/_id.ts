import { HttpError } from "@/lib/admin/tx";

/** Parses an [id] / [mediaId] route segment (positive int) or throws 404. */
export function routeId(raw: string | undefined): number {
  if (!raw || !/^\d{1,9}$/.test(raw) || Number(raw) < 1) throw new HttpError(404, "Not found.", "NOT_FOUND");
  return Number(raw);
}
