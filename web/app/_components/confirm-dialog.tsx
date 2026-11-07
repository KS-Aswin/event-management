"use client";

// In-page confirmation dialog: replaces window.confirm (which blocks the page,
// can't be styled and is suppressed by some mobile browsers). Usage:
//
//   const [confirm, confirmDialog] = useConfirm();
//   if (!(await confirm({ title: "Delete photo?", confirmLabel: "Delete", danger: true }))) return;
//   ... render {confirmDialog} somewhere in the component.
//
// A native <dialog> opened with showModal() gives focus trapping, Esc to
// cancel and an inert background for free.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get the danger button. */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const p = { ...opts, resolve };
      pendingRef.current = p;
      setPending(p);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.resolve(ok);
  }, []);

  // Resolve any open request as "cancel" if the component unmounts.
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  return [confirm, <ConfirmDialog key="confirm-dialog" request={pending} onSettle={settle} />];
}

function ConfirmDialog({ request, onSettle }: { request: Pending | null; onSettle: (ok: boolean) => void }) {
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
      role="alertdialog"
      onClose={() => onSettle(false)}
      aria-labelledby={`${uid}-t`}
      aria-describedby={request?.description ? `${uid}-d` : undefined}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-card bg-surface p-0 text-foreground shadow-pop backdrop:bg-black/45 sm:m-auto sm:max-w-[460px] sm:rounded-card"
    >
      {request ? (
        <div className="p-4 sm:p-6 safe-bottom">
          <h2 id={`${uid}-t`} className="font-display text-title font-semibold">
            {request.title}
          </h2>
          {request.description ? (
            <p id={`${uid}-d`} className="mt-1 text-body text-ink-soft">
              {request.description}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={() => onSettle(false)} autoFocus>
              {request.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              className={`btn ${request.danger ? "bg-danger text-white hover:bg-[#8f1f18]" : "btn-primary"}`}
              onClick={() => onSettle(true)}
            >
              {request.confirmLabel ?? "Continue"}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
