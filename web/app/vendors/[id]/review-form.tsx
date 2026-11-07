"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const MIN_BODY = 5;

export default function ReviewForm({ vendorId }: { vendorId: number }) {
  const router = useRouter();
  const uid = useId();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rating === 0) {
      setError("Please select a star rating.");
      return;
    }
    if (body.trim().length < MIN_BODY) {
      setError(`Please write at least ${MIN_BODY} characters.`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/vendors/${vendorId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setSubmitted(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div role="status" className="alert-success mt-4">
        Thanks — your review has been posted.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-card border border-line bg-surface-muted/60 p-4 sm:p-5 mt-5">
      <h3 className="text-[15px] font-semibold mb-1">Leave a review</h3>
      {error && (
        <div role="alert" className="alert-error my-2.5">
          {error}
        </div>
      )}
      <fieldset className="mb-3">
        <legend className="sr-only">Your rating</legend>
        <div className="flex gap-0.5 -ml-1.5" onMouseLeave={() => setHoverRating(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              onMouseEnter={() => setHoverRating(n)}
              className="inline-flex items-center justify-center w-11 h-11 text-[26px] leading-none cursor-pointer rounded-control has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name={`${uid}-rating`}
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="sr-only"
              />
              <span aria-hidden="true" className={n <= (hoverRating || rating) ? "text-gold" : "text-line-strong"}>
                ★
              </span>
              <span className="sr-only">{`${n} star${n > 1 ? "s" : ""}`}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${uid}-body`} className="sr-only">
        Your review
      </label>
      <textarea
        id={`${uid}-body`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="How was your experience with this vendor?"
        rows={3}
        required
        minLength={MIN_BODY}
        className="field resize-y min-h-[96px] mb-3"
      />
      <button
        type="submit"
        disabled={loading}
        className="btn btn-primary w-full sm:w-auto sm:px-6"
      >
        {loading ? "Posting…" : "Post review"}
      </button>
    </form>
  );
}
