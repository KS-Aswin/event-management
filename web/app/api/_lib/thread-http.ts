import { NextResponse } from "next/server";
import { threadErrorResponse } from "@/lib/enquiry-thread";

// Shared bits for the enquiry thread routes (/api/my/enquiries/*,
// /api/vendor/leads/[id]/messages|offers). Responses are per-user: no-store.

export const NO_STORE = { "Cache-Control": "private, no-store" };

export function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function bad(field: string, error: string) {
  return json(400, { error, code: "VALIDATION", field });
}

/** Reads a JSON object body, or null (-> 400). */
export async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** ThreadError / TransitionError -> 4xx JSON; anything else is rethrown. */
export function handleThreadError(err: unknown) {
  const r = threadErrorResponse(err);
  if (r) return json(r.status, r.body);
  throw err;
}

export const tooMany = () =>
  json(429, { error: "You're sending too fast. Please wait a minute and try again.", code: "RATE_LIMITED" });
