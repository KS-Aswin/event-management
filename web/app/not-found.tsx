import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 py-16 sm:py-24 w-full">
      <p className="mb-4 inline-flex items-center rounded-full bg-accent-tint px-3 py-1 text-caption font-semibold text-accent-hover">
        404
      </p>
      <h1 className="text-display sm:text-[32px] font-semibold mb-3">We couldn&apos;t find that page</h1>
      <p className="text-ink-soft text-[16px] leading-relaxed mb-8 max-w-[42ch]">
        The link may be old, or the vendor may no longer be listed. Try searching instead.
      </p>
      <div className="flex flex-col sm:flex-row justify-center gap-3 w-full max-w-[320px] sm:max-w-none sm:w-auto">
        <Link href="/search" className="btn btn-primary">
          Find vendors
        </Link>
        <Link href="/" className="btn btn-secondary">
          Go home
        </Link>
      </div>
    </main>
  );
}
