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
      <div role="status" className="text-sm text-accent bg-accent-tint rounded-md px-3.5 py-3 mt-4">
        Thanks — your review has been posted.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border border-line rounded-lg p-4 mt-4">
      <h3 className="text-sm font-medium mb-2">Leave a review</h3>
      {error && (
        <div role="alert" className="mb-2.5 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <fieldset className="mb-3">
        <legend className="sr-only">Your rating</legend>
        <div className="flex gap-1" onMouseLeave={() => setHoverRating(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              onMouseEnter={() => setHoverRating(n)}
              className="text-2xl leading-none cursor-pointer rounded has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name={`${uid}-rating`}
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="sr-only"
              />
              <span aria-hidden="true" className={n <= (hoverRating || rating) ? "text-gold" : "text-line"}>
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
        className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent mb-3"
      />
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-70"
      >
        {loading ? "Posting…" : "Post review"}
      </button>
    </form>
  );
}
