import Link from "next/link";

// Small server-safe building blocks shared by the ops pages (Today, users,
// enquiries, audit).

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "–";
  return DATE_FMT.format(new Date(v));
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "–";
  return DATETIME_FMT.format(new Date(v));
}

/** "just now", "12 min ago", "5 h ago", "3 days ago". */
export function ago(v: string | Date | null | undefined, now = Date.now()): string {
  if (!v) return "–";
  const s = Math.max(0, Math.round((now - new Date(v).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-accent-tint text-accent-hover",
  approved: "bg-accent-tint text-accent-hover",
  suspended: "bg-danger-tint text-danger",
  rejected: "bg-danger-tint text-danger",
  deleted: "bg-surface-muted text-ink-soft",
  pending: "bg-[#fdf6e0] text-gold-ink",
  changes_requested: "bg-[#fdf6e0] text-gold-ink",
  draft: "bg-surface-muted text-ink-soft",
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`chip font-medium ${STATUS_TONE[status] ?? ""}`}>{label ?? status.replace(/_/g, " ")}</span>
  );
}

/** Builds a query string from the current filters plus overrides; drops empty values. */
export function qs(base: Record<string, string | undefined>, over: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Previous / next pager (links keep the current filters). */
export function Pager({
  path,
  filters,
  page,
  pages,
  total,
  noun,
}: {
  path: string;
  filters: Record<string, string | undefined>;
  page: number;
  pages: number;
  total: number;
  noun: string;
}) {
  if (total === 0) return null;
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption text-ink-soft">
        {total.toLocaleString("en-IN")} {noun}
        {total === 1 ? "" : "s"} · page {page} of {pages}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className="btn btn-secondary btn-sm" href={`${path}${qs(filters, { page: String(page - 1) })}`} rel="prev">
            Previous
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm" aria-disabled="true">
            Previous
          </span>
        )}
        {page < pages ? (
          <Link className="btn btn-secondary btn-sm" href={`${path}${qs(filters, { page: String(page + 1) })}`} rel="next">
            Next
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm" aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}

/** Skeleton rows for loading.tsx files. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-3 w-16 rounded bg-surface-muted" />
      <div className="mt-2 h-7 w-48 rounded bg-surface-muted" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-16 rounded-card border border-line bg-surface-muted/60 motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}
