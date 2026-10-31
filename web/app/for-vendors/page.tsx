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
    <main className="max-w-[760px] mx-auto px-4 sm:px-6 py-10 w-full">
      <h1 className="text-display font-semibold mb-2">Grow your business with Vela</h1>
      <p className="text-ink-soft text-sm mb-6">
        List your business where couples and event planners across Kerala search for vendors.
      </p>
      <ul className="space-y-2 mb-6">
        {BENEFITS.map((b) => (
          <li key={b} className="text-body pl-6 relative">
            <span aria-hidden="true" className="absolute left-0 text-accent font-semibold">
              ✓
            </span>
            {b}
          </li>
        ))}
      </ul>
      {session?.role === "vendor" ? (
        <Link href="/dashboard" className="btn btn-primary">
          Go to your dashboard
        </Link>
      ) : session ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            You&apos;re signed in as a customer. A vendor listing uses a separate vendor account:
            log out, then create one with your business email.
          </p>
          <Link href="/dashboard" className="btn btn-secondary">
            Back to your dashboard
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Link href="/signup?role=vendor" className="btn btn-primary">
            Create vendor account
          </Link>
          <span className="text-sm text-ink-soft">
            Already on Vela?{" "}
            <Link href="/login" className="text-accent font-medium hover:underline">
              Sign in
            </Link>
          </span>
        </div>
      )}
    </main>
  );
}
