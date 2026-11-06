import Link from "next/link";
import { qs } from "@/app/admin/users/_components/ui";
import { plural } from "@/lib/admin/format";

/**
 * Previous / next pager for admin lists (links keep the current filters).
 * The count label pluralises properly ("1 entry", "647 entries").
 */
export function AdminPager({
  path,
  filters,
  page,
  pages,
  total,
  noun,
  nounPlural,
}: {
  path: string;
  filters: Record<string, string | undefined>;
  page: number;
  pages: number;
  total: number;
  noun: string;
  nounPlural?: string;
}) {
  if (total === 0) return null;
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption text-ink-soft" data-testid="pager-label">
        {plural(total, noun, nounPlural)} · page {page} of {pages}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className="btn btn-secondary btn-sm" href={`${path}${qs(filters, { page: String(Math.min(page, pages) - 1) })}`} rel="prev">
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
