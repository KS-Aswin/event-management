// Small fetch wrapper for the vendor detail actions: JSON in, JSON out, and
// the HTTP status so callers can treat 409 ("already handled") specially.

export type ApiResult =
  | { ok: true; status: number; data: Record<string, unknown> }
  | { ok: false; status: number; error: string; field?: string };

export async function adminFetch(url: string, method: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, status: res.status, data };
    const error =
      typeof data.error === "string"
        ? data.error
        : res.status === 401 || res.status === 403
          ? "Your session has ended. Please sign in again."
          : `Request failed (${res.status}).`;
    return { ok: false, status: res.status, error, field: typeof data.field === "string" ? data.field : undefined };
  } catch {
    return { ok: false, status: 0, error: "Network error. Check your connection and try again." };
  }
}
