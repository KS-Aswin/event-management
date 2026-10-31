export default function DashboardLoading() {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 w-full" aria-busy="true">
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading your dashboard…</span>
      </div>
      <div aria-hidden="true" className="animate-pulse">
        <div className="h-7 w-56 rounded bg-line mb-3" />
        <div className="h-4 w-72 rounded bg-line mb-6" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[76px] rounded-lg bg-line" />
          ))}
        </div>
        <div className="h-48 rounded-xl bg-line" />
      </div>
    </main>
  );
}
