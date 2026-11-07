"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReasonDialog, type ReasonRequest } from "@/app/admin/media/_components/reason-dialog";
import type { DecisionAction } from "@/lib/admin/vendors";
import type { VendorStatus } from "@/lib/db";
import { adminFetch } from "./api";

// P1-3 decisions on one listing. Every action opens a reason dialog (required
// for request changes / reject / suspend, optional note otherwise) and sends
// the status the admin saw as expectedStatus: if another admin got there
// first the API answers 409 and the page refreshes with a clear message.

const COPY: Record<
  DecisionAction,
  {
    button: string;
    title: string;
    description: (name: string, pendingMedia: number) => string;
    confirm: string;
    done: string;
    danger?: boolean;
    primary?: boolean;
    required: boolean;
    label: string;
    presets?: string[];
  }
> = {
  approve: {
    button: "Approve",
    title: "Approve this listing?",
    description: (n, m) =>
      `${n} goes live in search at once${m ? ` and its ${m} waiting photo${m === 1 ? "" : "s"} or video${m === 1 ? "" : "s"} are approved with it` : ""}. The vendor is notified.`,
    confirm: "Approve and publish",
    done: "Approved. The listing is live and the vendor was notified.",
    primary: true,
    required: false,
    label: "Note for the audit log (optional)",
  },
  request_changes: {
    button: "Request changes",
    title: "Ask for changes?",
    description: (n) => `${n} sees your note on their home page. When they resubmit, the listing comes back to Pending.`,
    confirm: "Send to vendor",
    done: "Sent back to the vendor with your note.",
    required: true,
    label: "What should the vendor change?",
    presets: [
      "Add at least 3 photos of your own work",
      "Add prices to your packages",
      "Write a fuller description of your services",
      "Remove contact details from photos and text",
    ],
  },
  reject: {
    button: "Reject",
    title: "Reject this listing?",
    description: (n) => `${n} is not published. The vendor sees your reason.`,
    confirm: "Reject listing",
    done: "Rejected. The vendor can see your reason.",
    danger: true,
    required: true,
    label: "Reason for the vendor",
    presets: ["Duplicate of an existing listing", "Not an event service", "Fake or misleading details"],
  },
  suspend: {
    button: "Suspend",
    title: "Suspend this listing?",
    description: (n) =>
      `${n} disappears from search and its page at once, and the owner is signed out and can't sign in until you unsuspend.`,
    confirm: "Suspend listing",
    done: "Suspended. The listing is hidden and the owner is signed out.",
    danger: true,
    required: true,
    label: "Reason (the vendor sees it)",
    presets: ["Fake reviews", "Repeated customer complaints", "Breaks the content policy"],
  },
  unsuspend: {
    button: "Unsuspend",
    title: "Lift the suspension?",
    description: (n) => `${n} goes back to the status it had before, and the owner can sign in again.`,
    confirm: "Unsuspend",
    done: "Suspension lifted.",
    required: false,
    label: "Note (optional)",
  },
  clear_rereview: {
    button: "Mark re-review done",
    title: "Clear the re-review flag?",
    description: (n) => `You checked the recent changes on ${n}. It stays live.`,
    confirm: "Mark as checked",
    done: "Re-review cleared.",
    required: false,
    label: "Note (optional)",
  },
};

// QA-039: on a live listing, "Request changes" unpublishes it until the
// vendor resubmits and it is approved again, so the dialog says so plainly.
const LIVE_REQUEST_CHANGES = {
  title: "Take the listing offline and ask for changes?",
  description: (n: string) =>
    `${n} is live now. Asking for changes takes it out of search and its public page goes offline at once. ` +
    "It stays hidden until the vendor resubmits and an admin approves it again. For a small fix, contact the vendor instead and keep it live.",
  confirm: "Take offline and send",
  done: "Taken offline and sent back to the vendor with your note.",
};

const ORDER: DecisionAction[] = ["approve", "clear_rereview", "request_changes", "reject", "unsuspend", "suspend"];

export default function DecisionPanel({
  vendorId,
  name,
  status,
  actions,
  verified,
  hasVerifiedDoc,
  pendingMedia,
}: {
  vendorId: number;
  name: string;
  status: VendorStatus;
  actions: DecisionAction[];
  verified: boolean;
  hasVerifiedDoc: boolean;
  pendingMedia: number;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<ReasonRequest | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);

  async function decide(action: DecisionAction, reason: string): Promise<string | null> {
    const r = await adminFetch(`/api/admin/vendors/${vendorId}/decision`, "POST", {
      action,
      reason: reason || undefined,
      expectedStatus: status,
    });
    if (!r.ok) {
      if (r.status === 409) {
        setDialog(null);
        setMessage({ kind: "error", text: "Another admin already changed this listing. The page has been refreshed: check it again." });
        router.refresh();
        return null;
      }
      return r.error;
    }
    setMessage({
      kind: "ok",
      text: action === "request_changes" && status === "approved" ? LIVE_REQUEST_CHANGES.done : COPY[action].done,
    });
    router.refresh();
    return null;
  }

  function ask(action: DecisionAction) {
    const c = COPY[action];
    const live = action === "request_changes" && status === "approved";
    setMessage(null);
    setDialog({
      title: live ? LIVE_REQUEST_CHANGES.title : c.title,
      description: live ? LIVE_REQUEST_CHANGES.description(name) : c.description(name, pendingMedia),
      confirmLabel: live ? LIVE_REQUEST_CHANGES.confirm : c.confirm,
      danger: live || c.danger,
      required: c.required,
      label: c.label,
      presets: c.presets,
      onConfirm: (reason) => decide(action, reason),
    });
  }

  async function setVerified(next: boolean, reason?: string): Promise<string | null> {
    setVerifyBusy(true);
    setMessage(null);
    const r = await adminFetch(`/api/admin/vendors/${vendorId}/verify`, "POST", { verified: next, reason: reason || undefined });
    setVerifyBusy(false);
    if (!r.ok) {
      if (r.status === 400) return r.error;
      setDialog(null);
      setMessage({ kind: "error", text: r.status === 409 ? `${r.error} The page has been refreshed.` : r.error });
      if (r.status === 409) router.refresh();
      return null;
    }
    setDialog(null);
    setMessage({
      kind: "ok",
      text: next ? "Verified badge added to the public profile." : "Verified badge removed. The vendor has been told.",
    });
    router.refresh();
    return null;
  }

  function toggleVerified() {
    if (!verified) {
      void setVerified(true);
      return;
    }
    // QA-107: removing the badge is visible to the vendor, so confirm it first
    // and let the admin say why (optional; it is sent to the vendor).
    setMessage(null);
    setDialog({
      title: "Remove the Verified badge?",
      description: `The badge will no longer show on ${name}'s public profile. The vendor is notified, with your note if you add one.`,
      confirmLabel: "Remove badge",
      danger: true,
      required: false,
      label: "Note to the vendor (optional)",
      onConfirm: (reason) => setVerified(false, reason),
    });
  }

  const sorted = ORDER.filter((a) => actions.includes(a));

  return (
    <div>
      <div aria-live="polite">
        {message ? (
          <div
            className={`${message.kind === "ok" ? "alert-success" : "alert-error"} mb-3 flex items-start justify-between gap-3`}
            data-testid="decision-message"
          >
            <span>{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="shrink-0 font-medium underline underline-offset-2 min-h-11 -my-3">
              Dismiss
            </button>
          </div>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <p className="text-body text-ink-soft">
          {status === "draft" ? "The vendor hasn't submitted this listing yet." : "No status changes are available."}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {sorted.map((a) => {
            const c = COPY[a];
            return (
              <button
                key={a}
                type="button"
                onClick={() => ask(a)}
                className={`btn ${c.primary ? "btn-primary sm:col-span-2" : c.danger ? "btn-secondary text-danger" : "btn-secondary"}`}
              >
                {c.button}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p id="verified-badge-h" className="font-medium">Verified business badge</p>
          <p id="verified-badge-d" className="text-caption text-ink-soft">
            {verified
              ? "Shown on the public profile."
              : status !== "approved"
                ? "Approve the listing first."
                : hasVerifiedDoc
                  ? "A business document is verified."
                  : "Verify a business document first (see Documents)."}
          </p>
        </div>
        <button
          type="button"
          // QA-098: a plain action button named by its visible text (WCAG 2.5.3),
          // so "click Mark verified" works; the heading and status line describe it.
          aria-describedby="verified-badge-h verified-badge-d"
          onClick={toggleVerified}
          disabled={verifyBusy || (!verified && (status !== "approved" || !hasVerifiedDoc))}
          className={`btn btn-sm ${verified ? "btn-secondary" : "btn-primary"} min-h-11`}
        >
          {verifyBusy ? "Saving…" : verified ? "Remove badge" : "Mark verified"}
        </button>
      </div>

      <ReasonDialog request={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
