"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

// Message composer for the enquiry thread (both sides). POSTs { body } to
// `endpoint`, then refreshes the server-rendered thread. Enter adds a new
// line; Ctrl/Cmd+Enter sends.
export default function Composer({
  endpoint,
  label,
  placeholder,
  closedReason,
}: {
  endpoint: string;
  label: string;
  placeholder: string;
  /** When set, the thread is closed and this explains why. */
  closedReason?: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (closedReason) {
    return <p className="text-body text-ink-soft bg-surface-muted rounded-control px-3 py-2.5">{closedReason}</p>;
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === "string" ? data.error : "Couldn't send. Please try again.");
        return;
      }
      setText("");
      setSent(true);
      router.refresh();
    } catch {
      setError("You seem to be offline. Your message wasn't sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-2">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <textarea
        id={id}
        className="field"
        rows={3}
        maxLength={4000}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setSent(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-caption min-h-5">
          {error ? <span className="text-danger">{error}</span> : sent ? <span className="text-ink-soft">Sent.</span> : null}
        </p>
        <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()} aria-busy={sending}>
          {sending ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}
