import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 py-16 w-full">
      <p className="text-sm font-semibold text-accent mb-2">404</p>
      <h1 className="text-display font-semibold mb-2">We couldn&apos;t find that page</h1>
      <p className="text-ink-soft text-sm mb-6 max-w-[420px]">
        The link may be old, or the vendor may no longer be listed. Try searching instead.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
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
