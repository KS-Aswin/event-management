import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "List your business",
  description:
    "List your wedding or event business on Vela and get quote requests from customers planning events in Kerala.",
  alternates: { canonical: "/for-vendors" },
};

// Only features that exist today.
const BENEFITS = [
  "A business profile with your portfolio, services and pricing",
  "Direct quote requests from customers actively planning an event",
  "A dashboard of your leads and customer reviews",
];

export default async function ForVendorsPage() {
  const session = await getSession();

  return (
    <main className="page-narrow sm:max-w-[920px] py-10 sm:py-16">
      <p className="eyebrow text-accent mb-3">For vendors</p>
      <h1 className="text-display sm:text-[36px] sm:leading-[1.15] font-semibold mb-4">
        Grow your business with Vela
      </h1>
      <p className="text-ink-soft text-[16px] sm:text-[18px] leading-relaxed mb-8 sm:mb-10 max-w-[52ch]">
        List your business where couples and event planners across Kerala search for vendors.
      </p>
      <ul className="grid gap-3 sm:grid-cols-3 sm:gap-4 mb-8 sm:mb-10">
        {BENEFITS.map((b) => (
          <li key={b} className="card flex sm:flex-col items-start gap-3 p-4 sm:p-5 text-[15px] leading-snug">
            <span
              aria-hidden="true"
              className="grid shrink-0 place-items-center w-8 h-8 rounded-full bg-accent-tint text-accent"
            >
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 10.5l3.5 3.5 7.5-8" />
              </svg>
            </span>
            <span className="pt-1 sm:pt-0">{b}</span>
          </li>
        ))}
      </ul>
      {session?.role === "vendor" ? (
        <Link href="/dashboard" className="btn btn-primary btn-lg w-full sm:w-auto">
          Go to your dashboard
        </Link>
      ) : session ? (
        <div className="space-y-4 rounded-card border border-line bg-surface-muted p-5 max-w-[60ch]">
          <p className="text-body text-ink-soft">
            You&apos;re signed in as a customer. A vendor listing uses a separate vendor account:
            log out, then create one with your business email.
          </p>
          <Link href="/dashboard" className="btn btn-secondary w-full sm:w-auto">
            Back to your dashboard
          </Link>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-x-5 gap-y-4">
          <Link href="/signup?role=vendor" className="btn btn-primary btn-lg w-full sm:w-auto">
            Create vendor account
          </Link>
          <span className="text-body text-ink-soft text-center sm:text-left">
            Already on Vela?{" "}
            <Link
              href="/login"
              className="inline-flex items-center min-h-[44px] text-accent font-medium underline-offset-2 hover:underline"
            >
              Sign in
            </Link>
          </span>
        </div>
      )}
    </main>
  );
}
