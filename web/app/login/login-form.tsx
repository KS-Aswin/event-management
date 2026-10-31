"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, PasswordField } from "./auth-fields";
import { withNext } from "./safe-next";

export default function LoginForm({
  next,
  initialEmail,
  notice = null,
}: {
  next: string;
  initialEmail: string;
  notice?: string | null;
}) {
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
        body: JSON.stringify({ email, password, next: next || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      // The server picks the landing page for the user's role.
      router.push(typeof data.redirectTo === "string" ? data.redirectTo : "/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex items-start sm:items-center justify-center bg-surface-muted px-4 sm:px-5 py-8 sm:py-14">
      <div className="w-full max-w-[440px] bg-surface border border-line rounded-card shadow-card p-6 sm:p-10">
        <span
          aria-hidden="true"
          className="block h-1 w-10 rounded-full bg-gold mb-5"
        />
        <h1 className="font-display text-2xl sm:text-[26px] font-semibold text-foreground tracking-tight">
          Welcome back
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-soft mt-2 mb-6">
          Sign in to manage your events or your vendor profile
        </p>

        {notice && !error && (
          <div role="status" className="alert-error mb-4">
            {notice}
          </div>
        )}

        {error && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="alert-error mb-4 outline-none"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="Email"
            name="email"
            type="email"
            value={email}
            onChange={setEmail}
            required
            autoComplete="email"
          />
          <PasswordField
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-block btn-lg !mt-6"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-ink-soft mt-6 pt-5 border-t border-line">
          Don&apos;t have an account?{" "}
          <Link
            href={withNext("/signup", next)}
            className="inline-flex items-center min-h-11 sm:min-h-0 text-accent font-medium hover:underline underline-offset-2"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
