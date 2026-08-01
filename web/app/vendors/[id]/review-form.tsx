"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReviewForm({ vendorId }: { vendorId: number }) {
  const router = useRouter();
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
    setLoading(true);
    const res = await fetch(`/api/vendors/${vendorId}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, body }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setSubmitted(true);
    router.refresh();
  }

  if (submitted) {
    return (
      <div className="text-sm text-accent bg-accent-tint rounded-md px-3.5 py-3 mb-4">
        Thanks — your review has been posted.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border border-line rounded-lg p-4 mb-4">
      <div className="text-sm font-medium mb-2">Leave a review</div>
      {error && (
        <div className="mb-2.5 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <div className="flex gap-1 mb-3" onMouseLeave={() => setHoverRating(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHoverRating(n)}
            className="text-2xl leading-none"
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
          >
            <span className={n <= (hoverRating || rating) ? "text-gold" : "text-line"}>★</span>
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="How was your experience with this vendor?"
        rows={3}
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
