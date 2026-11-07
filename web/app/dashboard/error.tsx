"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-16 w-full text-center">
      <h1 className="text-2xl font-semibold mb-2">Your dashboard couldn&apos;t load</h1>
      <p className="text-ink-soft text-sm mb-6">
        Check your connection and try again. Your enquiries and saved vendors are safe.
        {error.digest && <span className="block mt-1 text-xs">Reference: {error.digest}</span>}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium"
        >
          Try again
        </button>
        <Link href="/" className="px-4.5 py-2.5 rounded-md border border-line text-sm font-medium hover:border-accent">
          Go home
        </Link>
      </div>
    </main>
  );
}
