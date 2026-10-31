"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PRICE_UNITS, PRICE_UNIT_LABELS, type PriceUnit } from "@/lib/offering-validation";

// Small building blocks shared by the taxonomy manager and the custom queue.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

/** JSON fetch for the admin API; throws ApiError with the server's message. */
export async function adminApi<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      res.status === 401
        ? "Your session ended. Sign in again."
        : res.status === 403
          ? "You don't have access to this."
          : (data as { error?: string }).error ?? "Something went wrong. Please try again.";
    throw new ApiError(res.status, msg, (data as { code?: string }).code);
  }
  return data as T;
}

/** Modal dialog (bottom sheet on phones) built on <dialog>. */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={`${uid}-t`}
      className={`m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-card bg-surface p-0 shadow-pop backdrop:bg-black/45 sm:m-auto sm:rounded-card ${
        wide ? "sm:max-w-[760px]" : "sm:max-w-[520px]"
      }`}
    >
      {open && (
        <div className="p-4 sm:p-6 safe-bottom">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={`${uid}-t`} className="text-title font-semibold">
                {title}
              </h2>
              {description && <div className="text-body text-ink-soft mt-1">{description}</div>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm -mr-2 -mt-1 shrink-0" onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Polite status toast: call show("Saved"). */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 4500);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const node = (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      {msg && (
        <div className="pointer-events-auto max-w-md rounded-control bg-foreground px-4 py-3 text-sm text-white shadow-pop">
          {msg}
        </div>
      )}
    </div>
  );
  return { show, node };
}

export function unitLabel(u: string): string {
  return (PRICE_UNIT_LABELS[u as PriceUnit] ?? u).replace(/^per /, "");
}

/** Checkbox chips for allowed price units plus a default-unit select. */
export function UnitPicker({
  units,
  def,
  onChange,
  idPrefix,
}: {
  units: string[];
  def: string;
  onChange: (units: string[], def: string) => void;
  idPrefix: string;
}) {
  const toggle = (u: string) => {
    const next = units.includes(u) ? units.filter((x) => x !== u) : [...units, u];
    const sorted = PRICE_UNITS.filter((x) => next.includes(x));
    onChange(sorted, sorted.includes(def as PriceUnit) ? def : sorted[0] ?? "");
  };
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="label">Allowed price units</legend>
        <div className="flex flex-wrap gap-2">
          {PRICE_UNITS.map((u) => {
            const on = units.includes(u);
            return (
              <label
                key={u}
                className={`inline-flex min-h-[44px] sm:min-h-[36px] cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${
                  on ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong bg-surface"
                }`}
              >
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={on} onChange={() => toggle(u)} />
                {unitLabel(u)}
              </label>
            );
          })}
        </div>
        {units.length === 0 && <p className="hint text-danger">Pick at least one unit.</p>}
      </fieldset>
      <div>
        <label className="label" htmlFor={`${idPrefix}-def`}>
          Default unit
        </label>
        <select
          id={`${idPrefix}-def`}
          className="field sm:max-w-xs"
          value={def}
          onChange={(e) => onChange(units, e.target.value)}
          disabled={!units.length}
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {unitLabel(u)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function StatusChip({ active }: { active: boolean }) {
  return active ? null : <span className="chip bg-danger-tint text-danger">Retired</span>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="alert-error mt-3">
      {message}
    </p>
  );
}
