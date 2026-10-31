"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
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
    <main className="flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 py-16 w-full">
      <h1 className="text-display font-semibold mb-2">Something went wrong</h1>
      <p className="text-ink-soft text-sm mb-6 max-w-[420px]">
        This page couldn&apos;t load. Check your connection and try again.
        {error.digest && <span className="block mt-1 text-xs">Reference: {error.digest}</span>}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => reset()} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Go home
        </Link>
      </div>
    </main>
  );
}
