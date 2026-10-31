"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LEAD_STATUS_LABEL, asStatus, type QuoteStatusKey } from "./format";

const STATUS_OPTIONS: QuoteStatusKey[] = ["pending", "responded", "booked", "declined"];

// Which statuses the select offers from each status. A lead can't go back to
// "New" once handled (Undo still allows reverting a mis-tap right away);
// leaving "Booked" or "Not a fit" asks for confirmation first.
const NEXT_STATUSES: Record<QuoteStatusKey, QuoteStatusKey[]> = {
  pending: ["pending", "responded", "booked", "declined"],
  responded: ["responded", "booked", "declined"],
  booked: ["booked", "responded", "declined"],
  declined: ["declined", "responded", "booked"],
};

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

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  async function change(newStatus: QuoteStatusKey, isUndo = false) {
    if (newStatus === current) return;
    if (
      !isUndo &&
      (current === "booked" || current === "declined") &&
      !window.confirm(
        `This lead is marked "${LEAD_STATUS_LABEL[current]}". Change it to "${LEAD_STATUS_LABEL[newStatus]}"?`
      )
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
      if (!isUndo) {
        setUndoFrom(previous);
        undoTimer.current = setTimeout(() => setUndoFrom(null), 8000);
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const options = NEXT_STATUSES[current];

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <select
        value={current}
        disabled={saving}
        aria-label={leadName ? `Status of enquiry from ${leadName}` : "Enquiry status"}
        onChange={(e) => change(asStatus(e.target.value))}
        className="field w-auto min-w-[7.5rem] pr-8 text-[13px] font-medium disabled:opacity-60"
      >
        {STATUS_OPTIONS.filter((s) => options.includes(s)).map((s) => (
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
    </div>
  );
}
