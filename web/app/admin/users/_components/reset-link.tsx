"use client";

import { useState } from "react";
import ReasonDialog from "./reason-dialog";

// QA-007: one-time password reset link for a user who contacted support.
// No email provider yet, so the admin copies the link and sends it to the
// user over a channel they already trust (reply to the user's own email,
// WhatsApp to the phone on file). Shown once; creating another cancels it.
export default function ResetLink({ userId, name }: { userId: number; name: string }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(reason: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/admin/users/${userId}/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      const data = (await res.json().catch(() => null)) as { url?: string; expiresAt?: string; error?: string } | null;
      if (!res.ok || !data?.url || !data.expiresAt) return data?.error ?? `Request failed (${res.status}).`;
      setLink({ url: data.url, expiresAt: data.expiresAt });
      setCopied(false);
      setOpen(false);
      return null;
    } catch {
      return "Network error. Check your connection and try again.";
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const expires = link
    ? new Date(link.expiresAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "";

  return (
    <div className="mt-4 pt-4 border-t border-line">
      <h3 className="font-medium">Password reset</h3>
      <p className="text-body text-ink-soft mt-0.5">
        For a user who forgot their password. Check it&apos;s really them first (they write from the account email,
        or you call the phone on file).
      </p>
      <button type="button" className="btn btn-secondary mt-2.5" onClick={() => setOpen(true)}>
        {link ? "Create a new reset link" : "Create reset link"}
      </button>
      {link && (
        <div className="mt-3 rounded-control border border-line bg-surface-muted p-3" role="status">
          <p className="text-sm font-medium">One-time link for {name}, valid until {expires}</p>
          <p className="text-caption text-ink-soft mt-0.5">Shown only now. Send it only to the account holder.</p>
          <label className="sr-only" htmlFor={`reset-url-${userId}`}>
            Reset link
          </label>
          <input
            id={`reset-url-${userId}`}
            readOnly
            value={link.url}
            onFocus={(e) => e.currentTarget.select()}
            className="field mt-2 font-mono"
          />
          <button type="button" className="btn btn-primary mt-2" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      <ReasonDialog
        open={open}
        title="Create a password reset link?"
        description={
          <>
            Anyone with the link can set a new password for {name} within 24 hours, and it signs them out everywhere.
            Any older link stops working.
          </>
        }
        confirmLabel="Create link"
        reasonRequired={false}
        reasonLabel="Note"
        reasonHint="Saved in the audit log, e.g. how you checked who asked."
        onConfirm={create}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
