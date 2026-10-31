"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import ReasonDialog, { sendAdmin } from "@/app/admin/users/_components/reason-dialog";

/** "Block" button for a phone or email shown in the enquiry list. */
export function BlockButton({ value, label = "Block", compact }: { value: string; label?: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`btn btn-secondary ${compact ? "btn-sm" : ""} text-danger`}
        onClick={() => setOpen(true)}
        aria-label={`Block ${value}`}
      >
        {label}
      </button>
      <ReasonDialog
        open={open}
        title={`Block ${value}?`}
        description="New enquiries from this contact are refused with a generic message. Enquiries already sent stay with the vendors."
        confirmLabel="Block contact"
        reasonRequired
        reasonHint="Only admins see this."
        danger
        onConfirm={async (reason) => {
          const err = await sendAdmin("/api/admin/blocked-contacts", "POST", { value, reason });
          if (err) return err;
          setOpen(false);
          router.refresh();
          return null;
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** "Unblock" button in the blocked contacts list. */
export function UnblockButton({ id, value }: { id: number; value: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)} aria-label={`Unblock ${value}`}>
        Unblock
      </button>
      <ReasonDialog
        open={open}
        title={`Unblock ${value}?`}
        description="This contact can send enquiries again."
        confirmLabel="Unblock"
        reasonRequired={false}
        reasonHint="Saved in the audit log."
        onConfirm={async (reason) => {
          const err = await sendAdmin(`/api/admin/blocked-contacts/${id}`, "DELETE", reason ? { reason } : {});
          if (err) return err;
          setOpen(false);
          router.refresh();
          return null;
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** Block any phone or email by hand. */
export function BlockForm() {
  const router = useRouter();
  const valueId = useId();
  const reasonId = useId();
  const errId = useId();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(null);
    if (!value.trim()) return setError("Enter a phone number or email.");
    if (reason.trim().length < 3) return setError("Please give a reason (at least 3 characters).");
    setBusy(true);
    const err = await sendAdmin("/api/admin/blocked-contacts", "POST", { value, reason });
    setBusy(false);
    if (err) return setError(err);
    setError(null);
    setDone(`Blocked ${value.trim()}.`);
    setValue("");
    setReason("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end" noValidate>
      <div>
        <label htmlFor={valueId} className="label">
          Phone or email
        </label>
        <input
          id={valueId}
          className="field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="98470 12345"
          autoComplete="off"
          aria-describedby={error ? errId : undefined}
        />
      </div>
      <div>
        <label htmlFor={reasonId} className="label">
          Reason
        </label>
        <input
          id={reasonId}
          className="field"
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Spam to many vendors"
          aria-describedby={error ? errId : undefined}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Blocking…" : "Block"}
      </button>
      {error && (
        <p id={errId} role="alert" className="alert-error sm:col-span-3">
          {error}
        </p>
      )}
      <p role="status" className={done ? "alert-success sm:col-span-3" : "sr-only"}>
        {done ?? ""}
      </p>
    </form>
  );
}
