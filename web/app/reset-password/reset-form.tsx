"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PasswordField } from "../login/auth-fields";

// bcrypt only looks at the first 72 bytes of a password (same as sign-up).
const MAX_PASSWORD_BYTES = 72;

export default function ResetForm({ token, name }: { token: string; name: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (doneEmail !== null) doneRef.current?.focus();
  }, [doneEmail]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.trim().length < 8) {
      setError("Your password needs at least 8 characters (not counting spaces).");
      return;
    }
    if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
      setError("Your password is too long. Please use 72 characters or fewer.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      setDoneEmail(typeof data.email === "string" ? data.email : "");
    } catch {
      setError("Could not reach the server. Please try again.");
      setLoading(false);
    }
  }

  if (doneEmail !== null) {
    const q = doneEmail ? `?email=${encodeURIComponent(doneEmail)}` : "";
    return (
      <>
        <h1 ref={doneRef} tabIndex={-1} className="font-display text-2xl sm:text-[26px] font-semibold text-foreground tracking-tight outline-none">
          Password changed
        </h1>
        <p role="status" className="text-[15px] leading-relaxed text-ink-soft mt-2">
          You&apos;ve been signed out on your other devices. Sign in with your new password.
        </p>
        <Link href={`/login${q}`} className="btn btn-primary btn-block btn-lg mt-6">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="font-display text-2xl sm:text-[26px] font-semibold text-foreground tracking-tight">
        Choose a new password
      </h1>
      <p className="text-[15px] leading-relaxed text-ink-soft mt-2 mb-6">
        For the account of <span className="font-medium text-foreground break-words">{name}</span>. This link works once.
      </p>
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="alert-error mb-4 outline-none">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <PasswordField
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          hint="At least 8 characters."
        />
        <button type="submit" disabled={loading} className="btn btn-primary btn-block btn-lg !mt-6">
          {loading ? "Saving…" : "Save new password"}
        </button>
      </form>
    </>
  );
}
