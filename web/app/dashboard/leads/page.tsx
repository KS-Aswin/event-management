import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { findQuoteRequestsByVendor, findVendorByOwner } from "@/lib/db";
import { LeadRow } from "../lead-list";
import { LEAD_STATUS_LABEL, type QuoteStatusKey } from "../format";

export const metadata: Metadata = { title: "Enquiries" };

const TABS: { key: "all" | QuoteStatusKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: LEAD_STATUS_LABEL.pending },
  { key: "responded", label: LEAD_STATUS_LABEL.responded },
  { key: "booked", label: LEAD_STATUS_LABEL.booked },
  { key: "declined", label: LEAD_STATUS_LABEL.declined },
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/leads");
  if (session.role !== "vendor") redirect("/dashboard");

  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/dashboard/create-listing");

  const sp = await searchParams;
  const active = TABS.find((t) => t.key === sp.status)?.key ?? "all";

  const leads = await findQuoteRequestsByVendor(vendor.id);
  const shown = active === "all" ? leads : leads.filter((l) => l.status === active);
  const countFor = (key: (typeof TABS)[number]["key"]) =>
    key === "all" ? leads.length : leads.filter((l) => l.status === key).length;

  return (
    <main className="page-narrow py-8 sm:py-12">
      <Link href="/dashboard" className="btn btn-ghost btn-sm -ml-3.5">
        ← Dashboard
      </Link>
      <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight mt-1 mb-5">Enquiries</h1>

      <nav aria-label="Filter enquiries by status" className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.key === "all" ? "/dashboard/leads" : `/dashboard/leads?status=${t.key}`}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex items-center shrink-0 whitespace-nowrap min-h-11 sm:min-h-9 px-3.5 rounded-full border text-[13px] font-medium transition-colors ${
                isActive ? "bg-accent text-white border-accent" : "bg-white border-line-strong hover:border-accent hover:text-accent"
              }`}
            >
              {t.label} ({countFor(t.key)})
            </Link>
          );
        })}
      </nav>

      <div className="card sm:px-6">
        {shown.length === 0 ? (
          <p className="text-sm text-ink-soft">
            {leads.length === 0
              ? "No quote requests yet. Customer enquiries will show up here."
              : "No enquiries with this status."}
          </p>
        ) : (
          shown.map((l, i) => <LeadRow key={l.id} lead={l} last={i === shown.length - 1} />)
        )}
      </div>
    </main>
  );
}
