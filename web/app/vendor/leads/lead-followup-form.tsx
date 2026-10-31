"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { patchLead } from "./lead-status-control";

// Private notes and a follow-up date for one lead. Only the vendor sees these.
export default function LeadFollowupForm({
  leadId,
  initialNotes,
  initialFollowUp,
}: {
  leadId: number;
  initialNotes: string | null;
  initialFollowUp: string | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [followUp, setFollowUp] = useState(initialFollowUp ?? "");
  const [saved, setSaved] = useState({ notes: initialNotes ?? "", followUp: initialFollowUp ?? "" });
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty = notes.trim() !== saved.notes.trim() || followUp !== saved.followUp;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setState("saving");
    setError(null);
    const err = await patchLead(leadId, { vendorNotes: notes.trim() || null, followUpAt: followUp || null });
    if (err) {
      setError(err);
      setState("idle");
      return;
    }
    setSaved({ notes: notes.trim(), followUp });
    setState("saved");
    router.refresh();
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-describedby="followup-private">
      <p id="followup-private" className="text-caption text-ink-soft -mt-1">
        Only you can see these. The customer is not notified.
      </p>
      <div>
        <label htmlFor="lead-notes" className="label">
          Notes
        </label>
        <textarea
          id="lead-notes"
          className="field"
          rows={4}
          maxLength={2000}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setState("idle");
          }}
          placeholder="e.g. Wants traditional decor, sent sample photos, call back after 6 pm"
        />
      </div>
      <div>
        <label htmlFor="lead-followup" className="label">
          Follow-up date
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="lead-followup"
            type="date"
            className="field w-auto min-w-[11rem]"
            min={today}
            value={followUp}
            onChange={(e) => {
              setFollowUp(e.target.value);
              setState("idle");
            }}
          />
          {followUp && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setFollowUp("");
                setState("idle");
              }}
            >
              Clear date
            </button>
          )}
        </div>
        <p className="hint">Leads with a follow-up due show up on your home page.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!dirty || state === "saving"}>
          {state === "saving" ? "Saving…" : "Save notes"}
        </button>
        <span aria-live="polite" className="text-caption">
          {error ? <span className="text-danger">{error}</span> : state === "saved" ? <span className="text-accent">Saved</span> : null}
        </span>
      </div>
    </form>
  );
}
