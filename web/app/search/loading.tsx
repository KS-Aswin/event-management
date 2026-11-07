export default function Loading() {
  return (
    <main className="page w-full pt-4 pb-10 md:pt-8 md:pb-16" aria-busy="true">
      <p className="sr-only" role="status">
        Loading vendors…
      </p>
      <div className="md:pl-[280px]">
        <div className="h-4 w-32 bg-surface-muted rounded animate-pulse mb-6" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3.5 sm:gap-4.5 py-4 sm:py-4 border-b border-line sm:border-b-0">
            <div className="w-[88px] h-[88px] sm:w-[200px] sm:h-[140px] rounded-card bg-surface-muted shrink-0" />
            <div className="flex-1 space-y-2.5">
              <div className="h-4 w-1/2 bg-surface-muted rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-surface-muted rounded animate-pulse" />
              <div className="h-3 w-1/4 bg-surface-muted rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
