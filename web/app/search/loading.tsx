export default function Loading() {
  return (
    <main className="max-w-[1180px] mx-auto px-4 sm:px-6 py-6 w-full" aria-busy="true">
      <p className="sr-only" role="status">
        Loading vendors…
      </p>
      <div className="md:pl-[262px]">
        <div className="h-4 w-32 bg-gray-100 rounded mb-6" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3.5 sm:gap-4.5 py-4.5 border-b border-line">
            <div className="w-24 h-24 sm:w-[180px] sm:h-[130px] rounded-[10px] bg-gray-100 shrink-0" />
            <div className="flex-1 space-y-2.5">
              <div className="h-4 w-1/2 bg-gray-100 rounded" />
              <div className="h-3 w-2/3 bg-gray-100 rounded" />
              <div className="h-3 w-1/4 bg-gray-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
