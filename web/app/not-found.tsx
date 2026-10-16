import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
      <p className="font-display text-6xl font-semibold text-accent">404</p>
      <h1 className="text-xl font-semibold mt-3">We couldn&apos;t find that page</h1>
      <p className="text-ink-soft text-sm mt-1.5 mb-6">
        The link may be broken, or the page may have been removed.
      </p>
      <Link href="/" className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm">
        Back to home
      </Link>
    </main>
  );
}
