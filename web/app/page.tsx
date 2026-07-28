import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5">
      <h1 className="font-display text-6xl font-semibold text-accent mb-2">
        Vel<span className="text-gold">a</span>
      </h1>
      <p className="text-ink-soft mb-8 text-center">
        Kerala&apos;s marketplace for weddings &amp; events
        <br />
        <span className="text-xs">
          (real app in progress — see PROJECT_LOG.md for status)
        </span>
      </p>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="px-5 py-2.5 rounded-md border border-line text-sm hover:bg-gray-50"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="px-5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium"
        >
          Sign up
        </Link>
      </div>
    </main>
  );
}
