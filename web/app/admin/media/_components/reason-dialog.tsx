"use client";

// Reason dialog for moderation decisions (PRODUCT_PLAN 7 "Admin": every
// decision opens a reason dialog; required for reject, hide and remove).
// Used by /admin/media and /admin/reviews.

import { useEffect, useId, useRef, useState } from "react";

export interface ReasonRequest {
  title: string;
  description?: string;
  confirmLabel: string;
  /** Destructive actions get the danger button. */
  danger?: boolean;
  /** false = the note is optional (approve, unhide, dismiss). */
  required?: boolean;
  label?: string;
  presets?: string[];
  /** Resolves to an error message to show, or null on success (dialog closes). */
  onConfirm: (reason: string) => Promise<string | null>;
}

const keys = new WeakMap<ReasonRequest, number>();
let nextKey = 1;
function keyFor(r: ReasonRequest): number {
  let k = keys.get(r);
  if (!k) {
    k = nextKey++;
    keys.set(r, k);
  }
  return k;
}

export function ReasonDialog({ request, onClose }: { request: ReasonRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (request && !el.open) el.showModal();
    else if (!request && el.open) el.close();
  }, [request]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${uid}-t`}
      aria-describedby={request?.description ? `${uid}-d` : undefined}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-card bg-surface p-0 text-foreground shadow-pop backdrop:bg-black/45 sm:m-auto sm:max-w-[520px] sm:rounded-card"
    >
      {request ? <ReasonForm key={keyFor(request)} uid={uid} request={request} onClose={onClose} /> : null}
    </dialog>
  );
}

function ReasonForm({ uid, request, onClose }: { uid: string; request: ReasonRequest; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = request.required ?? true;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const text = reason.trim();
    if (required && text.length < 3) {
      setError("Please write at least a few words (3 characters or more).");
      return;
    }
    if (!required && text.length > 0 && text.length < 3) {
      setError("A note needs at least 3 characters, or leave it empty.");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await request.onConfirm(text);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <form onSubmit={submit} className="p-4 sm:p-6 safe-bottom" noValidate>
      <h2 id={`${uid}-t`} className="font-display text-title font-semibold">
        {request.title}
      </h2>
      {request.description ? (
        <p id={`${uid}-d`} className="mt-1 text-body text-ink-soft">
          {request.description}
        </p>
      ) : null}

      {request.presets?.length ? (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Common reasons">
          {request.presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setReason(p)}
              aria-pressed={reason === p}
              className={`min-h-11 rounded-full border px-3 text-sm transition-colors sm:min-h-9 ${
                reason === p ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong bg-surface hover:bg-surface-muted"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      ) : null}

      <label htmlFor={`${uid}-r`} className="label mt-4">
        {request.label ?? (required ? "Reason" : "Note (optional)")}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      <textarea
        id={`${uid}-r`}
        className="field"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
        rows={3}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${uid}-e` : undefined}
        autoFocus
      />
      {error ? (
        <p id={`${uid}-e`} role="alert" className="alert-error mt-3">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className={`btn ${request.danger ? "bg-danger text-white hover:bg-[#8f1f18]" : "btn-primary"}`}
        >
          {busy ? "Saving..." : request.confirmLabel}
        </button>
      </div>
    </form>
  );
}

/** POSTs JSON to an admin API; returns the parsed body or an error message. */
export async function postAdmin(
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data };
    return { ok: false, status: res.status, error: typeof data.error === "string" ? data.error : "Something went wrong." };
  } catch {
    return { ok: false, status: 0, error: "Network error. Check your connection and try again." };
  }
}
