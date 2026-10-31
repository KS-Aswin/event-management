export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex-1 flex flex-col items-center justify-center gap-3 min-h-[50vh] py-20 w-full"
    >
      <span
        aria-hidden="true"
        className="w-8 h-8 rounded-full border-[3px] border-accent-tint border-t-accent animate-spin"
      />
      <span className="text-caption text-ink-soft">Loading…</span>
    </div>
  );
}
