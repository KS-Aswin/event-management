import { NextResponse } from "next/server";
import { isHttpError } from "./tx";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** JSON response for admin APIs (always private, no-store). */
export function adminJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

/** Maps a thrown HttpError to its status; anything else is logged and 500. */
export function adminError(err: unknown): NextResponse {
  if (isHttpError(err)) {
    return adminJson({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status);
  }
  console.error("admin api error", err);
  return adminJson({ error: "Something went wrong. Please try again." }, 500);
}

/** Parses a JSON object body; null when missing or not an object. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Required reason for reject / request changes / suspend / hide (UI 7
 * "Admin"): trimmed, 3..1000 chars. Returns the reason or null if invalid.
 */
export function parseReason(v: unknown, { min = 3, max = 1000 } = {}): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : null;
}
