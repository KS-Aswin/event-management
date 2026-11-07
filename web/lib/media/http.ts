import { NextResponse } from "next/server";
import { requireRole } from "@/app/api/_lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { findVendorRefByOwner, type VendorRef } from "./repo";

// Shared helpers for /api/vendor/media/*. The vendor is always resolved from
// the session (never from the client), so every query is owner-scoped.

export function apiError(status: number, error: string, code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

export const notFound = () => apiError(404, "Not found.", "NOT_FOUND");

export async function requireVendor(opts?: { rateKey?: string; max?: number }): Promise<
  { userId: number; vendor: VendorRef } | NextResponse
> {
  const auth = await requireRole("vendor");
  if (auth instanceof NextResponse) return auth;
  if (opts?.rateKey && !checkRateLimit(`${opts.rateKey}:${auth.userId}`, opts.max ?? 60, 10 * 60_000)) {
    return apiError(429, "Too many requests. Please wait a few minutes and try again.", "RATE_LIMITED");
  }
  const vendor = await findVendorRefByOwner(auth.userId);
  if (!vendor) {
    return apiError(409, "Create your business profile first.", "NO_LISTING");
  }
  return { userId: auth.userId, vendor };
}

export function parsePositiveInt(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

/** Optional id field: undefined = not sent, null = clear, number = set. Returns "invalid" otherwise. */
export function optionalId(v: unknown): number | null | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return parsePositiveInt(v) ?? "invalid";
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function cleanText(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return s.length > max ? null : s;
}
