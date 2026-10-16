"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-ink-soft text-sm mt-1.5 mb-6">
        An unexpected error happened. Please try again.
      </p>
      <button
        onClick={() => reset()}
        className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm"
      >
        Try again
      </button>
    </main>
  );
}
