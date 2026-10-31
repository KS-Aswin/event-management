export default function DashboardLoading() {
  return (
    <main className="page-narrow py-8 sm:py-12" aria-busy="true">
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading your dashboard…</span>
      </div>
      <div aria-hidden="true" className="animate-pulse">
        <div className="h-7 w-56 rounded bg-line mb-3" />
        <div className="h-4 w-72 rounded bg-line mb-6" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[84px] rounded-card bg-line" />
          ))}
        </div>
        <div className="h-48 rounded-card bg-line" />
      </div>
    </main>
  );
}
