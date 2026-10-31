export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex-1 flex items-center justify-center py-20 w-full"
    >
      <span
        aria-hidden="true"
        className="w-8 h-8 rounded-full border-2 border-line border-t-accent animate-spin"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
