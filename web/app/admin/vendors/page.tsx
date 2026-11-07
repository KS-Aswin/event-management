import type { Metadata } from "next";
import Link from "next/link";
import { AdminEmptyState, AdminPage } from "@/app/admin/_components/admin-page";
import { ago, fmtDate, qs, StatusChip } from "@/app/admin/users/_components/ui";
import { AdminPager } from "@/app/admin/_components/pager";
import { TabNav } from "@/app/admin/_components/tab-nav";
import {
  countVendorTabs,
  CREATED_FILTERS,
  findFilterOptions,
  listAdminVendors,
  parseCreatedFilter,
  parseVendorTab,
  VENDOR_TABS,
  type AdminVendorRow,
  type VendorTab,
} from "@/lib/admin/vendors";

export const metadata: Metadata = { title: "Vendors" };

// P1-3 vendor approval queue: tabs per status (pending is FIFO by submit
// time), filters, duplicate hints, then /admin/vendors/[id] to decide.
// Today tiles link here with ?status=, ?rereview=1 and ?documents=pending.

const PAGE_SIZE = 25;

const TAB_BLURB: Partial<Record<VendorTab, string>> = {
  pending: "New listings waiting for a first check. Oldest first.",
  rereview: "Live listings whose vendor changed something important. They stay public while you check.",
  changes_requested: "Sent back to the vendor. They return to Pending when the vendor resubmits.",
  suspended: "Hidden from customers. The owner can't sign in.",
};

function str(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}
function posInt(v: string | undefined): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = parseVendorTab(str(sp.rereview) === "1" ? "rereview" : (str(sp.status) ?? "pending"));
  const q = str(sp.q)?.slice(0, 100);
  const districtId = posInt(str(sp.district));
  const categoryId = posInt(str(sp.category));
  const created = parseCreatedFilter(str(sp.created));
  const docsPending = str(sp.documents) === "pending";
  const requestedPage = posInt(str(sp.page)) ?? 1;

  const listPage = (p: number) =>
    listAdminVendors({
      tab,
      q,
      districtId,
      categoryId,
      createdWithinDays: created?.days,
      docsPending,
      limit: PAGE_SIZE,
      offset: (p - 1) * PAGE_SIZE,
    });
  let page = requestedPage;
  let data: { rows: AdminVendorRow[]; total: number } | null = null;
  let counts: Record<VendorTab, number> | null = null;
  let options: Awaited<ReturnType<typeof findFilterOptions>> = { districts: [], categories: [] };
  try {
    [data, counts, options] = await Promise.all([listPage(page), countVendorTabs(), findFilterOptions()]);
    // An out-of-range ?page= (old link, the queue shrank) shows the last real
    // page instead of an empty "Nothing waiting" (QA-019).
    const last = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    if (data.total > 0 && page > last) {
      page = last;
      data = await listPage(page);
    }
  } catch (err) {
    console.error("admin vendors list", err);
  }

  // Filters kept across tabs and pages (status is the tab itself).
  const filters = {
    q,
    district: districtId ? String(districtId) : undefined,
    category: categoryId ? String(categoryId) : undefined,
    created: created?.key,
    documents: docsPending ? "pending" : undefined,
  };
  const filtered = Boolean(q || districtId || categoryId || created || docsPending);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const tabLabel = VENDOR_TABS.find((t) => t.key === tab)?.label ?? "Pending";

  return (
    <AdminPage title="Vendors" description="Approve new listings, re-check edited ones and manage every vendor.">
      <TabNav label="Vendor queues" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line" data-testid="vendor-tabs">
          {VENDOR_TABS.map((t) => {
            const active = t.key === tab;
            const n = counts?.[t.key];
            return (
              <li key={t.key}>
                <Link
                  href={`/admin/vendors${qs(filters, { status: t.key })}`}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors ${
                    active ? "border-accent text-accent-hover" : "border-transparent text-ink-soft hover:text-foreground"
                  }`}
                >
                  {t.label}
                  {typeof n === "number" ? (
                    <span
                      className={`rounded-full px-2 text-xs leading-5 tabular-nums ${
                        active ? "bg-accent-tint text-accent-hover" : "bg-surface-muted text-ink-soft"
                      }`}
                    >
                      {n.toLocaleString("en-IN")}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </TabNav>
      {TAB_BLURB[tab] && <p className="mt-3 text-body text-ink-soft max-w-prose">{TAB_BLURB[tab]}</p>}

      <form
        method="get"
        action="/admin/vendors"
        role="search"
        aria-label="Filter vendors"
        className="card p-4 mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] xl:items-end"
      >
        <input type="hidden" name="status" value={tab} />
        {docsPending && <input type="hidden" name="documents" value="pending" />}
        <div className="sm:col-span-2 xl:col-span-1">
          <label htmlFor="vendors-q" className="label">
            Search
          </label>
          <input
            id="vendors-q"
            name="q"
            type="search"
            className="field"
            defaultValue={q ?? ""}
            placeholder="Name, owner email, phone or #id"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="vendors-district" className="label">
            District
          </label>
          <select id="vendors-district" name="district" className="field" defaultValue={districtId ? String(districtId) : ""}>
            <option value="">All districts</option>
            {options.districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vendors-category" className="label">
            Category
          </label>
          <select id="vendors-category" name="category" className="field" defaultValue={categoryId ? String(categoryId) : ""}>
            <option value="">All categories</option>
            {options.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vendors-created" className="label">
            Created
          </label>
          <select id="vendors-created" name="created" className="field" defaultValue={created?.key ?? ""}>
            <option value="">Any time</option>
            {CREATED_FILTERS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 sm:col-span-2 xl:col-span-1">
          <button type="submit" className="btn btn-primary flex-1 xl:flex-none">
            Filter
          </button>
          {filtered && (
            <Link href={`/admin/vendors${qs({ status: tab })}`} className="btn btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      {docsPending && (
        <p className="mt-3 text-body flex flex-wrap items-center gap-2">
          <span className="chip font-medium bg-[#fdf6e0] text-gold-ink">Documents waiting for review</span>
          <Link href={`/admin/vendors${qs({ ...filters, documents: undefined, status: tab })}`} className="underline underline-offset-2 text-ink-soft hover:text-foreground min-h-11 inline-flex items-center">
            Show all
          </Link>
        </p>
      )}

      <div className="mt-5">
        {!data ? (
          <div className="alert-error" role="alert">
            The vendor list couldn&apos;t load. <Link href="/admin/vendors" className="underline">Try again</Link>.
          </div>
        ) : data.rows.length === 0 ? (
          <AdminEmptyState
            title={filtered ? "No vendors match" : tab === "pending" ? "Nothing waiting" : `No ${tabLabel.toLowerCase()} vendors`}
            body={
              filtered
                ? "Try a shorter search or clear the filters."
                : tab === "pending"
                  ? "New listings show up here when vendors submit them."
                  : "Listings move here as their status changes."
            }
            action={filtered ? { href: `/admin/vendors${qs({ status: tab })}`, label: "Clear filters" } : undefined}
          />
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 px-4 pb-2 eyebrow">
              <span>Vendor</span>
              <span>Category · district</span>
              <span>Status</span>
              <span>{tab === "pending" ? "Submitted" : "Updated"}</span>
            </div>
            <ul className="border border-line rounded-card divide-y divide-line bg-white overflow-hidden" data-testid="vendors-list">
              {data.rows.map((v) => (
                <VendorRow key={v.id} v={v} tab={tab} />
              ))}
            </ul>
          </>
        )}
        {data && (
          <AdminPager path="/admin/vendors" filters={{ ...filters, status: tab }} page={page} pages={pages} total={data.total} noun="vendor" />
        )}
      </div>
    </AdminPage>
  );
}

function VendorRow({ v, tab }: { v: AdminVendorRow; tab: VendorTab }) {
  const when = tab === "pending" ? v.submitted_at ?? v.created_at : v.updated_at ?? v.created_at;
  return (
    <li data-vendor-id={v.id}>
      <Link
        href={`/admin/vendors/${v.id}`}
        className="grid gap-x-4 gap-y-1 px-4 py-3 min-h-11 hover:bg-surface-muted focus-visible:bg-surface-muted grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-center"
      >
        {/* At phone width the name gets the whole first line; category, status
            and time go underneath so they never squeeze the name (QA-020). */}
        <span className="min-w-0 col-span-2 lg:col-span-1">
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-medium truncate" data-testid="vendor-row-name">{v.name}</span>
            {v.verified_at && (
              <span className="chip text-xs bg-accent-tint text-accent-hover shrink-0" title="Verified business">
                Verified
              </span>
            )}
          </span>
          <span className="block text-caption text-ink-soft truncate">
            #{v.id} · {v.owner_email ?? "No owner (unclaimed)"}
            {v.phone ? ` · ${v.phone}` : ""}
          </span>
          {(v.duplicates.length > 0 || v.pending_media > 0 || v.pending_documents > 0 || (v.rereview_required && v.status === "approved")) && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {v.duplicates.length > 0 && (
                <span className="chip text-xs bg-danger-tint text-danger max-w-full whitespace-normal break-words rounded-control" data-testid="duplicate-chip">
                  Possible duplicate: {v.duplicates.slice(0, 2).map((d) => d.name).join(", ")}
                  {v.duplicates.length > 2 ? ` +${v.duplicates.length - 2}` : ""}
                </span>
              )}
              {v.rereview_required && v.status === "approved" && (
                <span className="chip text-xs bg-[#fdf6e0] text-gold-ink max-w-full whitespace-normal break-words rounded-control">
                  Re-review{v.rereview_fields.length ? `: ${v.rereview_fields.join(", ").replace(/_/g, " ")}` : ""}
                </span>
              )}
              {v.pending_media > 0 && (
                <span className="chip text-xs bg-surface-muted text-ink-soft">
                  {v.pending_media} media to check
                </span>
              )}
              {v.pending_documents > 0 && (
                <span className="chip text-xs bg-surface-muted text-ink-soft">
                  {v.pending_documents} document{v.pending_documents === 1 ? "" : "s"} to check
                </span>
              )}
            </span>
          )}
        </span>
        <span className="text-caption lg:text-body text-ink-soft min-w-0 truncate self-center">
          {[v.category, v.district].filter(Boolean).join(" · ") || "–"}
        </span>
        <span className="justify-self-end lg:justify-self-auto">
          <StatusChip status={v.status} />
        </span>
        <span className="text-caption text-ink-soft col-span-2 lg:col-span-1" title={fmtDate(when)}>
          {ago(when)}
        </span>
      </Link>
    </li>
  );
}
