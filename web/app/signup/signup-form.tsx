"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, PasswordField } from "../login/auth-fields";
import { withNext } from "../login/safe-next";

type Role = "customer" | "vendor";

const ROLES: { value: Role; title: string; description: string }[] = [
  { value: "customer", title: "I'm planning an event", description: "Find and contact vendors." },
  { value: "vendor", title: "I'm a vendor", description: "List your business and receive enquiries." },
];

// bcrypt only looks at the first 72 bytes of a password.
const MAX_PASSWORD_BYTES = 72;

function passwordProblem(password: string): string | null {
  if (password.trim().length < 8) return "Your password needs at least 8 characters (not counting spaces).";
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES)
    return "Your password is too long. Please use 72 characters or fewer.";
  return null;
}

export default function SignupForm({ next, initialRole }: { next: string; initialRole: Role }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(initialRole);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [loading, setLoading] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailTaken(false);
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          setEmailTaken(true);
          setError("An account with this email already exists.");
        } else {
          setError(data.error ?? "Something went wrong. Please try again.");
        }
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
        <h1 className="font-display text-[22px] font-semibold text-foreground">Create your account</h1>
        <p className="text-sm text-ink-soft mt-1.5 mb-5">
          Plan an event, or list your business as a vendor
        </p>

        {error && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="mb-3.5 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 outline-none"
          >
            {error}
            {emailTaken && (
              <>
                {" "}
                <Link
                  href={withNext("/login", next, { email: email.trim() })}
                  className="font-medium underline"
                >
                  Sign in instead
                </Link>
              </>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <fieldset>
            <legend className="block text-[13px] text-ink-soft mb-1.5">I want to…</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ROLES.map((r) => {
                const selected = role === r.value;
                return (
                  <label
                    key={r.value}
                    className={`relative flex flex-col min-h-11 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40 ${
                      selected ? "border-accent bg-accent-tint" : "border-line hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r.value}
                      checked={selected}
                      onChange={() => setRole(r.value)}
                      className="sr-only"
                    />
                    <span className={`text-[13px] font-medium ${selected ? "text-accent" : "text-foreground"}`}>
                      {r.title}
                    </span>
                    <span className="text-xs text-ink-soft mt-0.5">{r.description}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Field label="Your name" name="name" value={name} onChange={setName} required autoComplete="name" />
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
            autoComplete="new-password"
            minLength={8}
            hint="At least 8 characters."
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-11 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-medium transition-colors disabled:opacity-70 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
          <p className="text-xs text-ink-soft text-center">
            By creating an account you agree to our{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy policy
            </Link>
            .
          </p>
        </form>

        <p className="text-center text-[13px] text-ink-soft mt-4.5">
          Already have an account?{" "}
          <Link href={withNext("/login", next)} className="text-accent font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
