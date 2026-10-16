"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setLoading(false);
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setLoading(false);
      setError("Could not reach the server. Please try again.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafafa] px-5 py-10">
      <div className="w-full max-w-[400px] bg-white border border-line rounded-xl shadow-[0_4px_18px_rgba(0,0,0,0.05)] p-9">
        <h1 className="font-display text-[22px] font-semibold">Reset your password</h1>
        {sent ? (
          <>
            <p className="text-sm text-ink-soft mt-3 mb-5">
              If an account exists for <span className="font-medium text-foreground">{email}</span>, we&apos;ve
              sent a link to reset the password. It works for 1 hour.
            </p>
            <Link href="/login" className="text-accent text-sm font-medium hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-soft mt-1.5 mb-5">
              Enter your email and we&apos;ll send you a reset link.
            </p>
            {error && (
              <div className="mb-3.5 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-medium disabled:opacity-70"
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <p className="text-center text-[13px] text-ink-soft mt-4.5">
              <Link href="/login" className="text-accent font-medium hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
