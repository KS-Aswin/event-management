"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function ResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      setLoading(false);
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setLoading(false);
      setError("Could not reach the server. Please try again.");
    }
  }

  if (!token) {
    return (
      <p className="text-sm text-ink-soft mt-3">
        This reset link is missing its token.{" "}
        <Link href="/forgot-password" className="text-accent hover:underline">
          Request a new one
        </Link>
        .
      </p>
    );
  }

  if (done) {
    return (
      <>
        <p className="text-sm text-ink-soft mt-3 mb-5">Your password has been changed.</p>
        <Link
          href="/login"
          className="inline-block px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium"
        >
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-ink-soft mt-1.5 mb-5">Choose a new password (8–72 characters).</p>
      {error && (
        <div className="mb-3.5 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder="New password"
          className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-medium disabled:opacity-70"
        >
          {loading ? "Saving…" : "Change password"}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafafa] px-5 py-10">
      <div className="w-full max-w-[400px] bg-white border border-line rounded-xl shadow-[0_4px_18px_rgba(0,0,0,0.05)] p-9">
        <h1 className="font-display text-[22px] font-semibold">New password</h1>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
