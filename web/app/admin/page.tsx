import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Today",
};

// Placeholder until the P1 admin "Today" inbox ships (PRODUCT_PLAN 2.5).
export default function AdminHomePage() {
  return (
    <main className="page py-8 sm:py-12">
      <p className="eyebrow">Admin</p>
      <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight mt-1">
        Today
      </h1>
      <p className="text-ink-soft text-lead mt-2 max-w-prose">
        The moderation queues (new vendors, reported reviews, media to check and custom offerings)
        will appear here.
      </p>
      <div className="card mt-6 max-w-xl">
        <h2 className="text-title font-semibold">Nothing to review yet</h2>
        <p className="text-body text-ink-soft mt-1">
          The admin tools are being built. Until then you can check the public site as visitors see it.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Link href="/search" className="btn btn-secondary">
            Browse vendors
          </Link>
          <Link href="/settings" className="btn btn-ghost">
            Account settings
          </Link>
        </div>
      </div>
    </main>
  );
}
