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
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 w-full">
      <Link href="/dashboard" className="text-[13px] text-accent hover:underline">
        ← Dashboard
      </Link>
      <h1 className="text-2xl font-semibold mt-2 mb-4">Enquiries</h1>

      <nav aria-label="Filter enquiries by status" className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.key === "all" ? "/dashboard/leads" : `/dashboard/leads?status=${t.key}`}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex items-center min-h-10 px-3 rounded-full border text-[13px] ${
                isActive ? "bg-accent text-white border-accent" : "border-line hover:border-accent"
              }`}
            >
              {t.label} ({countFor(t.key)})
            </Link>
          );
        })}
      </nav>

      <div className="border border-line rounded-xl p-5.5">
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
