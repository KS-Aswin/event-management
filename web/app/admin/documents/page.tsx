import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage } from "@/app/admin/_components/admin-page";
import { listDocumentQueue, type DocumentQueue } from "@/lib/admin/documents";
import { DOC_TABS, parseDocTab, type DocTab } from "@/app/vendor/documents/doc-meta";
import DocumentQueueList from "./_components/document-queue";

export const metadata: Metadata = { title: "Documents" };

const TAB_LABEL: Record<DocTab, string> = {
  pending: "Pending",
  verified: "Verified",
  rejected: "Rejected",
  expired: "Expired",
};

const TAB_BLURB: Record<DocTab, string> = {
  pending: "Oldest first. Open each file, check the name matches the listing, then verify with the expiry date or reject with a reason.",
  verified: "Valid documents. A vendor needs at least one before you give the Verified business badge.",
  rejected: "Documents you turned down. The vendor sees the reason and can upload a new one.",
  expired: "Verified documents past their expiry date. The listing stays live; the vendor is asked to upload the renewed licence.",
};

function href(tab: DocTab, vendorId: number | null, page = 1) {
  const p = new URLSearchParams({ tab });
  if (vendorId) p.set("vendor", String(vendorId));
  if (page > 1) p.set("page", String(page));
  return `/admin/documents?${p.toString()}`;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; vendor?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const tab = parseDocTab(sp.tab);
  const vendorId = sp.vendor && /^\d{1,9}$/.test(sp.vendor) ? Number(sp.vendor) : null;
  const page = Math.max(1, Number(sp.page) || 1);
  let queue: DocumentQueue | null = null;
  try {
    queue = await listDocumentQueue({ tab, vendorId, page });
  } catch (err) {
    console.error("admin documents queue", err);
  }
  const pages = queue ? Math.max(1, Math.ceil(queue.total / queue.pageSize)) : 1;

  return (
    <AdminPage title="Documents" description="Business documents vendors upload for the Verified business badge. Files are private.">
      {vendorId ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-control border border-line bg-surface-muted px-3 py-2 text-body">
          <span className="min-w-0">
            Showing documents for{" "}
            <Link href={`/admin/vendors/${vendorId}`} className="font-medium underline underline-offset-2">
              {queue?.vendor?.name ?? `vendor #${vendorId}`}
            </Link>
          </span>
          <Link href={href(tab, null)} className="btn btn-ghost btn-sm ml-auto">
            Show all vendors
          </Link>
        </div>
      ) : null}

      <nav aria-label="Document queues" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {DOC_TABS.map((t) => {
            const active = t === tab;
            const n = queue?.counts[t];
            return (
              <li key={t}>
                <Link
                  href={href(t, vendorId)}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors ${
                    active ? "border-accent text-accent-hover" : "border-transparent text-ink-soft hover:text-foreground"
                  }`}
                >
                  {TAB_LABEL[t]}
                  {typeof n === "number" ? (
                    <span
                      className={`rounded-full px-2 text-xs leading-5 tabular-nums ${
                        active ? "bg-accent-tint text-accent-hover" : "bg-surface-muted text-ink-soft"
                      }`}
                    >
                      {n}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <p className="mt-3 max-w-prose text-body text-ink-soft">{TAB_BLURB[tab]}</p>

      <div className="mt-5">
        {!queue ? (
          <div className="alert-error max-w-xl" role="alert">
            Could not load the documents queue. Refresh the page to try again.
          </div>
        ) : (
          <DocumentQueueList key={`${tab}-${vendorId}-${page}`} tab={tab} items={queue.items} />
        )}
      </div>

      {queue && pages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link className="btn btn-secondary" href={href(tab, vendorId, page - 1)}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-caption text-ink-soft tabular-nums">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link className="btn btn-secondary" href={href(tab, vendorId, page + 1)}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </AdminPage>
  );
}
