"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Shown on /login?enquiry=<token> to a customer who is already signed in:
// adds that guest enquiry to their account on an explicit click (QA-003).
export default function ClaimEnquiry({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function add() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/link-enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      router.push(typeof data.redirectTo === "string" ? data.redirectTo : "/my/enquiries");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="flex-1 flex items-start sm:items-center justify-center bg-surface-muted px-4 sm:px-5 py-8 sm:py-14">
      <div className="w-full max-w-[440px] bg-surface border border-line rounded-card shadow-card p-6 sm:p-10">
        <span aria-hidden="true" className="block h-1 w-10 rounded-full bg-gold mb-5" />
        <h1 className="font-display text-2xl sm:text-[26px] font-semibold text-foreground tracking-tight">
          Add this enquiry to your account?
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-soft mt-2 mb-6">
          You&apos;re signed in. Add the enquiry from your private link to your account to reply to the vendor,
          accept offers and keep everything in one place.
        </p>
        {error && (
          <div role="alert" className="alert-error mb-4">
            {error}
          </div>
        )}
        <button type="button" onClick={add} disabled={loading} className="btn btn-primary btn-block btn-lg">
          {loading ? "Adding…" : "Add to my account"}
        </button>
        <Link href="/my/enquiries" className="btn btn-secondary btn-block mt-2.5">
          Not now
        </Link>
      </div>
    </main>
  );
}
