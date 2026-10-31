"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, PasswordField } from "../login/auth-fields";
import { withNext } from "../login/safe-next";

type Role = "customer" | "vendor";

const ROLES: { value: Role; title: string; description: string }[] = [
  {
    value: "customer",
    title: "I'm planning an event",
    description: "Find and contact vendors.",
  },
  {
    value: "vendor",
    title: "I'm a vendor",
    description: "List your business and receive enquiries.",
  },
];

// bcrypt only looks at the first 72 bytes of a password.
const MAX_PASSWORD_BYTES = 72;

function passwordProblem(password: string): string | null {
  if (password.trim().length < 8)
    return "Your password needs at least 8 characters (not counting spaces).";
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES)
    return "Your password is too long. Please use 72 characters or fewer.";
  return null;
}

export default function SignupForm({
  next,
  initialRole,
}: {
  next: string;
  initialRole: Role;
}) {
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
    <div className="flex-1 flex items-start sm:items-center justify-center bg-surface-muted px-4 sm:px-5 py-8 sm:py-14">
      <div className="w-full max-w-[440px] bg-surface border border-line rounded-card shadow-card p-6 sm:p-10">
        <span
          aria-hidden="true"
          className="block h-1 w-10 rounded-full bg-gold mb-5"
        />
        <h1 className="font-display text-2xl sm:text-[26px] font-semibold text-foreground tracking-tight">
          Create your account
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-soft mt-2 mb-6">
          Plan an event, or list your business as a vendor
        </p>

        {error && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="alert-error mb-4 outline-none"
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset>
            <legend className="label">I want to…</legend>
            <div className="grid grid-cols-1 gap-2.5">
              {ROLES.map((r) => {
                const selected = role === r.value;
                return (
                  <label
                    key={r.value}
                    className={`relative flex items-start gap-3 min-h-11 cursor-pointer rounded-card border px-3.5 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                      selected
                        ? "border-accent bg-accent-tint shadow-[inset_0_0_0_1px_var(--color-accent)]"
                        : "border-line-strong bg-surface hover:border-accent/60 hover:bg-surface-muted"
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
                    {/* Visual radio dot; the real input above is visually hidden. */}
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 grid place-items-center size-[18px] shrink-0 rounded-full border-2 transition-colors ${
                        selected ? "border-accent" : "border-line-strong"
                      }`}
                    >
                      <span
                        className={`size-2 rounded-full bg-accent transition-transform ${selected ? "scale-100" : "scale-0"}`}
                      />
                    </span>
                    <span className="flex flex-col">
                      <span
                        className={`text-sm font-medium ${selected ? "text-accent-hover" : "text-foreground"}`}
                      >
                        {r.title}
                      </span>
                      <span className="text-[13px] leading-snug text-ink-soft mt-0.5">
                        {r.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Field
            label="Your name"
            name="name"
            value={name}
            onChange={setName}
            required
            autoComplete="name"
          />
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
            className="btn btn-primary btn-block btn-lg !mt-6"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
          <p className="text-[13px] text-ink-soft text-center">
            By creating an account you agree to our{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy policy
            </Link>
            .
          </p>
        </form>

        <p className="text-center text-sm text-ink-soft mt-6 pt-5 border-t border-line">
          Already have an account?{" "}
          <Link
            href={withNext("/login", next)}
            className="inline-flex items-center min-h-11 sm:min-h-0 text-accent font-medium hover:underline underline-offset-2"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
