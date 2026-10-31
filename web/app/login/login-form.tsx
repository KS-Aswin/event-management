"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, PasswordField } from "./auth-fields";
import { withNext } from "./safe-next";

export default function LoginForm({ next, initialEmail }: { next: string; initialEmail: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-[#fafafa] px-4 sm:px-5 py-10">
      <div className="w-full max-w-[400px] bg-white border border-line rounded-xl shadow-[0_4px_18px_rgba(0,0,0,0.05)] p-6 sm:p-9">
        <h1 className="font-display text-[22px] font-semibold text-foreground">Welcome back</h1>
        <p className="text-sm text-ink-soft mt-1.5 mb-5">
          Sign in to manage your events or your vendor profile
        </p>

        {error && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="mb-3.5 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 outline-none"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <Field
            label="Email"
            name="email"
            type="email"
            value={email}
            onChange={setEmail}
            required
            autoComplete="email"
          />
          <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-11 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-medium transition-colors disabled:opacity-70 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-[13px] text-ink-soft mt-4.5">
          Don&apos;t have an account?{" "}
          <Link href={withNext("/signup", next)} className="text-accent font-medium hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
