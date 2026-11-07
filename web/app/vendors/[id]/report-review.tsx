"use client";

import { useId, useState } from "react";

const REASONS = [
  "Fake or not a real customer",
  "Abusive, hateful or discriminatory",
  "Shares phone numbers or other contact details",
  "Spam or unrelated to this vendor",
];

/**
 * "Report" link under a public review (POST /api/reviews/[id]/report).
 * Signed-out visitors are sent to sign in; reports go to the admin
 * review queue (P1-5).
 */
export default function ReportReview({ reviewId, loginHref }: { reviewId: number; loginHref: string }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "signin" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const text = details.trim() ? `${reason}: ${details.trim()}` : reason;
    try {
      const res = await fetch(`/api/reviews/${reviewId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: text.slice(0, 500) }),
      });
      if (res.status === 401) return setState("signin");
      if (res.ok || res.status === 409) return setState("sent");
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not send the report. Please try again.");
      setState("error");
    } catch {
      setError("Network error. Please try again.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <p role="status" className="mt-2 text-caption text-ink-soft">
        Thanks for reporting. Our team will check this review.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="-ml-2 mt-1 inline-flex min-h-11 items-center rounded-control px-2 text-caption font-medium text-ink-soft hover:text-foreground hover:underline"
      >
        Report review
      </button>
    );
  }

  if (state === "signin") {
    return (
      <div role="status" className="mt-2 rounded-card border border-line bg-surface-muted/60 p-3 text-sm">
        <p className="font-medium">Sign in to report a review</p>
        <p className="mt-0.5 text-ink-soft">This helps us stop fake reports.</p>
        <div className="mt-2 flex gap-2">
          <a href={loginHref} className="btn btn-sm btn-primary">
            Sign in
          </a>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setOpen(false); setState("idle"); }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-2 rounded-card border border-line bg-surface-muted/60 p-3">
      <fieldset>
        <legend className="text-sm font-medium">What&apos;s wrong with this review?</legend>
        <div className="mt-1 grid gap-0.5">
          {REASONS.map((r) => (
            <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-surface-muted">
              <input
                type="radio"
                name={`${uid}-reason`}
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="h-4 w-4 accent-accent"
              />
              <span className="text-sm">{r}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${uid}-details`} className="label mt-2">
        Details (optional)
      </label>
      <textarea
        id={`${uid}-details`}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={400}
        rows={2}
        className="field"
      />
      {error ? (
        <p role="alert" className="alert-error mt-2">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={state === "sending"} className="btn btn-sm btn-primary">
          {state === "sending" ? "Sending..." : "Send report"}
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setOpen(false); setState("idle"); setError(null); }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
