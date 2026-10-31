import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage, AdminEmptyState } from "@/app/admin/_components/admin-page";
import { auditFacets, cleanAuditFilters, listAudit, type AuditRow } from "@/lib/admin/ops";
import { fmtDateTime, Pager } from "@/app/admin/users/_components/ui";

export const metadata: Metadata = { title: "Audit log" };

// P1-2 viewer: the append-only admin_audit_log, newest first, filterable by
// action, entity and actor, with a collapsible before / after diff.
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const f = cleanAuditFilters(await searchParams);
  const [data, facets] = await Promise.all([listAudit(f), auditFacets()]);
  const filters = { action: f.action, entity: f.entityType, entityId: f.entityId, actor: f.actor };
  const filtered = Object.values(filters).some(Boolean);

  return (
    <AdminPage title="Audit log" description="Every admin action, newest first. Entries can't be edited or deleted.">
      <form method="get" action="/admin/audit" role="search" className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
        <div>
          <label htmlFor="audit-action" className="label">
            Action
          </label>
          <select id="audit-action" name="action" className="field" defaultValue={f.action ?? ""}>
            <option value="">All actions</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-entity" className="label">
            Entity
          </label>
          <select id="audit-entity" name="entity" className="field" defaultValue={f.entityType ?? ""}>
            <option value="">All entities</option>
            {facets.entityTypes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-entity-id" className="label">
            Entity ID
          </label>
          <input id="audit-entity-id" name="entityId" className="field" inputMode="numeric" defaultValue={f.entityId ?? ""} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="audit-actor" className="label">
            Admin
          </label>
          <input id="audit-actor" name="actor" className="field" defaultValue={f.actor ?? ""} placeholder="Email, name or ID" autoComplete="off" />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <button type="submit" className="btn btn-primary flex-1 lg:flex-none">
            Filter
          </button>
          {filtered && (
            <Link href="/admin/audit" className="btn btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="mt-5">
        {data.rows.length === 0 ? (
          <AdminEmptyState
            title={filtered ? "No entries match" : "No admin actions yet"}
            body={filtered ? "Try fewer filters." : "Approvals, suspensions and other admin actions are recorded here."}
            action={filtered ? { href: "/admin/audit", label: "Clear filters" } : undefined}
          />
        ) : (
          <ol className="border border-line rounded-card divide-y divide-line bg-white" data-testid="audit-list">
            {data.rows.map((a) => (
              <AuditItem key={a.id} a={a} />
            ))}
          </ol>
        )}
        <Pager path="/admin/audit" filters={filters} page={data.page} pages={data.pages} total={data.total} noun="entry" />
      </div>
    </AdminPage>
  );
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  user: (id) => `/admin/users/${id}`,
  vendor: (id) => `/admin/vendors/${id}`,
};

function actorLabel(a: AuditRow): string {
  if (a.actor_name) return a.actor_name;
  if (a.actor_id) return `Admin #${a.actor_id}`;
  return a.action.startsWith("admin.") ? "System (CLI)" : "Deleted admin or system";
}

function show(v: unknown): string {
  if (v === undefined) return "–";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Top-level keys whose value differs between before and after. */
function diff(before: unknown, after: unknown): { key: string; before: unknown; after: unknown }[] {
  const b = before && typeof before === "object" && !Array.isArray(before) ? (before as Record<string, unknown>) : null;
  const af = after && typeof after === "object" && !Array.isArray(after) ? (after as Record<string, unknown>) : null;
  if (!b && !af) {
    return before === undefined && after === undefined ? [] : [{ key: "value", before, after }];
  }
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(af ?? {})])];
  return keys
    .map((key) => ({ key, before: b ? b[key] : undefined, after: af ? af[key] : undefined }))
    .filter((d) => JSON.stringify(d.before) !== JSON.stringify(d.after));
}

function AuditItem({ a }: { a: AuditRow }) {
  const href = ENTITY_HREF[a.entity_type]?.(a.entity_id);
  const hasData = a.before != null || a.after != null;
  const changes = hasData ? diff(a.before ?? undefined, a.after ?? undefined) : [];
  return (
    <li className="px-4 py-3" data-audit-id={a.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0">
          <span className="chip font-mono font-medium">{a.action}</span>{" "}
          {href ? (
            <Link href={href} className="text-body hover:underline underline-offset-2">
              {a.entity_type} #{a.entity_id}
            </Link>
          ) : (
            <span className="text-body">
              {a.entity_type} #{a.entity_id}
            </span>
          )}
        </p>
        <p className="text-caption text-ink-soft">
          <time dateTime={new Date(a.created_at).toISOString()}>{fmtDateTime(a.created_at)}</time>
        </p>
      </div>
      <p className="text-caption text-ink-soft mt-1">
        by {actorLabel(a)}
        {a.actor_email ? ` (${a.actor_email})` : ""}
        {a.ip ? ` · ${a.ip}` : ""}
      </p>
      {a.reason && <p className="text-body mt-1 break-words">“{a.reason}”</p>}
      {hasData && (
        <details className="mt-2 group">
          <summary className="cursor-pointer select-none text-body text-accent min-h-11 inline-flex items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-accent">
            <span className="group-open:hidden">Show changes</span>
            <span className="hidden group-open:inline">Hide changes</span>
            <span className="text-ink-soft">({changes.length})</span>
          </summary>
          {changes.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded-control border border-line">
              <table className="w-full text-caption">
                <thead className="bg-surface-muted text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Field</th>
                    <th scope="col" className="px-3 py-2 font-medium">Before</th>
                    <th scope="col" className="px-3 py-2 font-medium">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {changes.map((c) => (
                    <tr key={c.key} className="align-top">
                      <th scope="row" className="px-3 py-2 font-mono font-normal text-left whitespace-nowrap">{c.key}</th>
                      <td className="px-3 py-2 font-mono break-all bg-danger-tint/40 min-w-[8rem]">{show(c.before)}</td>
                      <td className="px-3 py-2 font-mono break-all bg-accent-tint/50 min-w-[8rem]">{show(c.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-caption text-ink-soft min-h-11 inline-flex items-center">Raw JSON</summary>
            <pre className="mt-1 p-3 rounded-control bg-surface-muted text-caption overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify({ before: a.before, after: a.after }, null, 2)}
            </pre>
          </details>
        </details>
      )}
    </li>
  );
}
