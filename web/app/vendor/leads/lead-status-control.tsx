"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/_components/confirm-dialog";
import { canTransition, nextStatuses } from "@/lib/enquiry-status";
import { LEAD_STATUS_LABEL, asStatus, type QuoteStatusKey } from "./format";

const ORDER: QuoteStatusKey[] = ["pending", "responded", "accepted", "booked", "declined", "withdrawn", "expired"];

// The select offers the current status plus the moves the status machine
// (lib/enquiry-status.ts, P2-5) allows a vendor from it; the server checks
// again and answers 409 otherwise. Leaving "Booked" or "Not a fit" asks for
// confirmation first. Withdrawn enquiries can't be changed at all.
function optionsFor(current: QuoteStatusKey): QuoteStatusKey[] {
  const allowed = new Set<string>([current, ...nextStatuses(current, "vendor")]);
  return ORDER.filter((s) => allowed.has(s));
}

/** PATCH /api/vendor/leads/[id]. Returns an error message, or null on success. */
export async function patchLead(
  leadId: number,
  body: { status?: QuoteStatusKey; vendorNotes?: string | null; followUpAt?: string | null }
): Promise<string | null> {
  try {
    const res = await fetch(`/api/vendor/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return typeof data?.error === "string" ? data.error : "Couldn't save. Please try again.";
  } catch {
    return "You seem to be offline. Nothing was changed.";
  }
}

export default function LeadStatusControl({
  leadId,
  status,
  leadName,
  hasEventDate = false,
}: {
  leadId: number;
  status: string;
  leadName?: string;
  hasEventDate?: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<QuoteStatusKey>(asStatus(status));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoFrom, setUndoFrom] = useState<QuoteStatusKey | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  async function change(newStatus: QuoteStatusKey, isUndo = false) {
    if (newStatus === current) return;
    if (
      !isUndo &&
      (current === "booked" || current === "declined") &&
      !(await confirm({
        title: `Change to "${LEAD_STATUS_LABEL[newStatus]}"?`,
        description: `This lead is marked "${LEAD_STATUS_LABEL[current]}".${
          current === "booked" ? " Its event date will be freed on your calendar." : ""
        }`,
        confirmLabel: `Change to ${LEAD_STATUS_LABEL[newStatus]}`,
      }))
    ) {
      return;
    }
    const previous = current;
    setCurrent(newStatus); // optimistic
    setSaving(true);
    setError(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoFrom(null);
    try {
      const err = await patchLead(leadId, { status: newStatus });
      if (err) {
        setCurrent(previous); // roll back on failure
        setError(err);
        return;
      }
      if (!isUndo && canTransition(newStatus, previous, "vendor")) {
        setUndoFrom(previous);
        undoTimer.current = setTimeout(() => setUndoFrom(null), 8000);
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const options = optionsFor(current);
  // Nothing the vendor can change (withdrawn by the customer): the pill says it all.
  if (options.length <= 1) return null;

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <select
        value={current}
        disabled={saving}
        aria-label={leadName ? `Status of enquiry from ${leadName}` : "Enquiry status"}
        onChange={(e) => change(asStatus(e.target.value))}
        className="field w-auto min-w-[7.5rem] pr-8 text-[13px] font-medium disabled:opacity-60"
      >
        {options.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <div aria-live="polite" className="text-[11.5px] text-right max-w-[200px]">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : undoFrom ? (
          <span className="text-ink-soft">
            {current === "booked" && hasEventDate ? "Booked, date blocked" : `Changed to ${LEAD_STATUS_LABEL[current]}`} ·{" "}
            <button
              type="button"
              onClick={() => change(undoFrom, true)}
              className="inline-flex items-center min-h-11 sm:min-h-6 font-medium text-accent underline"
            >
              Undo
            </button>
          </span>
        ) : null}
      </div>
      {confirmDialog}
    </div>
  );
}
