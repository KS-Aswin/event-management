"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/_components/confirm-dialog";

// Customer actions on their enquiry (PRODUCT_PLAN P2-4/P2-5): accept or
// decline an offer, withdraw, mark booked. The server applies the status
// machine; a 409 comes back as a readable message.

async function act(enquiryId: number, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`/api/my/enquiries/${enquiryId}`, {
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

export function OfferActions({ enquiryId, offerId, version, vendorName, total }: { enquiryId: number; offerId: number; version: number; vendorName: string; total: string }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");

  async function accept() {
    const ok = await confirm({
      title: `Accept offer v${version}?`,
      description: `${vendorName} is told you accepted ${total}. Confirm the details and any advance directly with them, then mark the enquiry booked.`,
      confirmLabel: "Accept offer",
    });
    if (!ok) return;
    setBusy("accept");
    setError(null);
    const err = await act(enquiryId, { action: "accept", offerId });
    setBusy(null);
    if (err) setError(err);
    else router.refresh();
  }

  async function decline(e: React.FormEvent) {
    e.preventDefault();
    setBusy("decline");
    setError(null);
    const err = await act(enquiryId, { action: "decline", offerId, message: note.trim() || null });
    setBusy(null);
    if (err) setError(err);
    else {
      setDeclining(false);
      router.refresh();
    }
  }

  return (
    <div>
      {!declining ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={accept} disabled={busy !== null} aria-busy={busy === "accept"}>
            {busy === "accept" ? "Accepting…" : "Accept offer"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setDeclining(true)} disabled={busy !== null}>
            Decline
          </button>
        </div>
      ) : (
        <form onSubmit={decline} className="flex flex-col gap-2">
          <label htmlFor={`decline-${offerId}`} className="label">
            Tell {vendorName} why (optional)
          </label>
          <textarea
            id={`decline-${offerId}`}
            className="field"
            rows={2}
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Over our budget, could you do it for less without the drone?"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy !== null} aria-busy={busy === "decline"}>
              {busy === "decline" ? "Declining…" : "Decline offer"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDeclining(false)} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-caption text-danger mt-2">
          {error}
        </p>
      )}
      {dialog}
    </div>
  );
}

export function EnquiryActions({
  enquiryId,
  canWithdraw,
  canBook,
  vendorName,
}: {
  enquiryId: number;
  canWithdraw: boolean;
  canBook: boolean;
  vendorName: string;
}) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!canWithdraw && !canBook) return null;

  async function run(action: "withdraw" | "booked") {
    const ok =
      action === "withdraw"
        ? await confirm({
            title: "Withdraw this enquiry?",
            description: `${vendorName} is told you no longer need them. You can't undo this; send a new enquiry if you change your mind.`,
            confirmLabel: "Withdraw",
            danger: true,
          })
        : await confirm({
            title: `Mark ${vendorName} as booked?`,
            description: "Do this once you've confirmed with the vendor (for example after paying the advance). They're told right away.",
            confirmLabel: "Mark booked",
          });
    if (!ok) return;
    setBusy(action);
    setError(null);
    const err = await act(enquiryId, { action });
    setBusy(null);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {canBook && (
        <button type="button" className="btn btn-primary btn-block" onClick={() => run("booked")} disabled={busy !== null} aria-busy={busy === "booked"}>
          {busy === "booked" ? "Saving…" : "Mark as booked"}
        </button>
      )}
      {canWithdraw && (
        <button type="button" className="btn btn-ghost btn-block text-danger" onClick={() => run("withdraw")} disabled={busy !== null} aria-busy={busy === "withdraw"}>
          {busy === "withdraw" ? "Withdrawing…" : "Withdraw enquiry"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
      {dialog}
    </div>
  );
}
