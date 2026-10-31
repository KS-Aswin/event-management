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
    <main className="flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 py-16 sm:py-24 w-full">
      <span
        aria-hidden="true"
        className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-danger-tint text-danger text-xl font-semibold"
      >
        !
      </span>
      <h1 className="text-display sm:text-[32px] font-semibold mb-3">Something went wrong</h1>
      <p className="text-ink-soft text-[16px] leading-relaxed mb-8 max-w-[42ch]">
        This page couldn&apos;t load. Check your connection and try again.
        {error.digest && (
          <span className="block mt-2 text-caption">
            Reference: <code className="font-mono">{error.digest}</code>
          </span>
        )}
      </p>
      <div className="flex flex-col sm:flex-row justify-center gap-3 w-full max-w-[320px] sm:max-w-none sm:w-auto">
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
