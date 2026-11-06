"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const MAX = 1000;

// Public reply to one review (PRODUCT_PLAN P2-11): POST the first reply,
// PATCH to edit it within 7 days. The server enforces both rules.
export default function ReplyForm({
  reviewId,
  initial,
  mode,
  onDone,
}: {
  reviewId: number;
  initial?: string;
  mode: "create" | "edit";
  onDone?: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const [text, setText] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body = text.trim();
    if (body.length < 2) {
      setError("Write your reply first.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/vendor/reviews/${reviewId}/reply`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't save your reply. Please try again.");
        return;
      }
      onDone?.();
      router.refresh();
    } catch {
      setError("You seem to be offline. Your reply wasn't saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3">
      <label htmlFor={`${uid}-reply`} className="label">
        {mode === "create" ? "Your public reply" : "Edit your reply"}
      </label>
      <textarea
        id={`${uid}-reply`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX}
        rows={3}
        aria-invalid={!!error}
        aria-describedby={`${uid}-hint`}
        placeholder="Thank the customer, or answer a concern politely. Everyone can read this."
        className="field"
      />
      <p id={`${uid}-hint`} className="hint">
        {mode === "create" ? "One reply per review. You can edit it for 7 days." : "Edits are allowed for 7 days after you first replied."}{" "}
        <span className="tabular-nums">
          {text.length}/{MAX}
        </span>
      </p>
      {error && (
        <p role="alert" className="alert-error mt-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 mt-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : mode === "create" ? "Post reply" : "Save reply"}
        </button>
        {mode === "edit" && onDone && (
          <button type="button" className="btn btn-ghost" onClick={onDone} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
