"use client";

import { useEffect, useId, useRef, useState } from "react";

// Confirmation dialog with a reason field, used for suspend, force logout,
// block and unblock (UI 7 "Admin": every decision opens a reason dialog;
// required for suspend and block). Native <dialog>: focus trap, Escape and
// inert background come from the browser. Bottom sheet on phones.

export interface ReasonDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  /** Required reasons must be 3+ characters. */
  reasonRequired: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  danger?: boolean;
  /** Extra fields rendered above the reason (e.g. the contact to block). */
  children?: React.ReactNode;
  /** Resolve with an error message to keep the dialog open, or null on success. */
  onConfirm: (reason: string) => Promise<string | null>;
  onClose: () => void;
}

export default function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  reasonRequired,
  reasonLabel = "Reason",
  reasonHint,
  danger,
  children,
  onConfirm,
  onClose,
}: ReasonDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const hintId = useId();
  const errorId = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setReason("");
      setError(null);
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = reason.trim();
    if (reasonRequired && r.length < 3) {
      setError("Please give a reason (at least 3 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const err = await onConfirm(r);
      if (err) setError(err);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      className="p-0 m-0 mt-auto sm:m-auto w-full max-w-none sm:max-w-[460px] max-h-[92dvh] overflow-auto overscroll-contain bg-white text-foreground rounded-t-2xl rounded-b-none sm:rounded-card shadow-pop backdrop:bg-[rgb(32_33_36/0.55)]"
    >
      <form onSubmit={submit} className="px-5 sm:px-6 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6">
        <h2 id={titleId} className="font-display text-title font-semibold leading-snug">
          {title}
        </h2>
        {description && <div className="text-body text-ink-soft mt-1.5">{description}</div>}
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-4">
          <label htmlFor={reasonId} className="label">
            {reasonLabel}
            {reasonRequired ? "" : <span className="font-normal text-ink-soft"> (optional)</span>}
          </label>
          <textarea
            id={reasonId}
            className="field"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required={reasonRequired}
            aria-invalid={error ? true : undefined}
            aria-describedby={[reasonHint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined}
          />
          {reasonHint && (
            <p id={hintId} className="hint">
              {reasonHint}
            </p>
          )}
        </div>
        {error && (
          <p id={errorId} role="alert" className="alert-error mt-3">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className={`btn ${danger ? "bg-danger text-white hover:bg-[#8f1e18]" : "btn-primary"}`}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** PATCH/POST/DELETE JSON to an admin API; returns the error message or null. */
export async function sendAdmin(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401 || res.status === 403) {
      return data?.error ?? "Your session has ended. Please sign in again.";
    }
    return data?.error ?? `Request failed (${res.status}).`;
  } catch {
    return "Network error. Check your connection and try again.";
  }
}
