"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafafa] px-5 py-10">
      <div className="w-full max-w-[400px] bg-white border border-line rounded-xl shadow-[0_4px_18px_rgba(0,0,0,0.05)] p-9">
        <h1 className="font-display text-[22px] font-semibold text-foreground">
          Welcome back
        </h1>
        <p className="text-sm text-ink-soft mt-1.5 mb-5">
          Sign in to manage your events or your vendor profile
        </p>

        <button
          type="button"
          disabled
          title="Google sign-in isn't connected yet — needs a Google OAuth client set up first."
          className="w-full flex items-center justify-center gap-2.5 py-2.5 border border-line rounded-md text-sm text-ink-soft bg-white opacity-60 cursor-not-allowed"
        >
          <GoogleIcon />
          Continue with Google (coming soon)
        </button>

        <div className="flex items-center gap-2.5 my-4.5 text-ink-soft text-xs">
          <span className="flex-1 h-px bg-line" />
          or sign in with email
          <span className="flex-1 h-px bg-line" />
        </div>

        {error && (
          <div className="mb-3.5 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[13px] text-ink-soft mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-[13px] text-ink-soft mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-soft"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-medium transition-colors disabled:opacity-70"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-[13px] text-ink-soft mt-4.5">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-accent font-medium hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.9 32.3 29.4 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1 7.3 2.7l6-6C33.6 6.5 29 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c2.8 0 5.3 1 7.3 2.7l6-6C33.6 6.5 29 4.5 24 4.5c-7.5 0-14 4.2-17.7 10.2z"
      />
      <path
        fill="#4CAF50"
        d="M24 43.5c5.3 0 10-1.8 13.6-5l-6.3-5.3C29.3 34.6 26.8 35.5 24 35.5c-5.4 0-9.9-3.6-11.5-8.5l-6.5 5C9.9 39.1 16.4 43.5 24 43.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.7 2-2 3.7-3.7 4.9l6.3 5.3C41.4 35 43.5 30 43.5 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
