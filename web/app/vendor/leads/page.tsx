import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findDistricts, findLeadsByVendor, findOfferingsByVendor, getOwnVendor, type LeadFilters } from "@/lib/db";
import { LeadRow } from "./lead-row";
import { LEAD_STATUS_LABEL, type QuoteStatusKey } from "./format";

export const metadata: Metadata = { title: "Leads" };

const TABS: { key: "all" | QuoteStatusKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: LEAD_STATUS_LABEL.pending },
  { key: "responded", label: LEAD_STATUS_LABEL.responded },
  { key: "booked", label: LEAD_STATUS_LABEL.booked },
  { key: "declined", label: LEAD_STATUS_LABEL.declined },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const posInt = (v: string) => (/^\d{1,9}$/.test(v) && Number(v) > 0 ? Number(v) : undefined);

// Leads inbox (PRODUCT_PLAN P0-14): status tabs plus filters by event date,
// district and the offering the customer asked for.
export default async function VendorLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session } = await requirePageRole("vendor");
  const vendor = await getOwnVendor(session.userId);
  if (!vendor) redirect("/vendor/onboarding");

  const sp = await searchParams;
  const active = TABS.find((t) => t.key === one(sp.status))?.key ?? "all";
  const from = DATE_RE.test(one(sp.from)) ? one(sp.from) : "";
  const to = DATE_RE.test(one(sp.to)) ? one(sp.to) : "";
  const districtId = posInt(one(sp.district));
  const serviceId = posInt(one(sp.serviceId));

  const filters: LeadFilters = { limit: 200 };
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (districtId) filters.districtId = districtId;
  if (serviceId) filters.serviceId = serviceId;

  const [leads, districts, offerings] = await Promise.all([
    findLeadsByVendor(vendor.id, filters),
    findDistricts(),
    findOfferingsByVendor(vendor.id, { includeInactive: true }),
  ]);
  const shown = active === "all" ? leads : leads.filter((l) => l.status === active);
  const countFor = (key: (typeof TABS)[number]["key"]) =>
    key === "all" ? leads.length : leads.filter((l) => l.status === key).length;
  const filtered = !!(from || to || districtId || serviceId);

  const tabHref = (key: string) => {
    const q = new URLSearchParams();
    if (key !== "all") q.set("status", key);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (districtId) q.set("district", String(districtId));
    if (serviceId) q.set("serviceId", String(serviceId));
    const s = q.toString();
    return s ? `/vendor/leads?${s}` : "/vendor/leads";
  };

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-5">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Leads</h1>
        <p className="text-ink-soft text-lead mt-1">
          Enquiries from customers. Reply quickly: customers usually book whoever answers first.
        </p>
      </header>

      <nav aria-label="Filter leads by status" className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto mb-4">
        <ul className="flex gap-2 w-max">
          {TABS.map((t) => {
            const isActive = t.key === active;
            return (
              <li key={t.key}>
                <Link
                  href={tabHref(t.key)}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex items-center shrink-0 whitespace-nowrap min-h-11 sm:min-h-9 px-3.5 rounded-full border text-[13px] font-medium transition-colors ${
                    isActive ? "bg-accent text-white border-accent" : "bg-surface border-line-strong hover:border-accent hover:text-accent"
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 tabular-nums ${isActive ? "text-white/85" : "text-ink-soft"}`}>{countFor(t.key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <details className="card p-0 mb-4 group" open={filtered}>
        <summary className="flex items-center justify-between gap-2 min-h-11 px-4 cursor-pointer select-none text-sm font-medium list-none [&::-webkit-details-marker]:hidden">
          <span>
            Filters
            {filtered && <span className="ml-2 chip bg-accent-tint text-accent-hover">On</span>}
          </span>
          <span aria-hidden="true" className="text-ink-soft transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <form method="get" action="/vendor/leads" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end px-4 pb-4">
          {active !== "all" && <input type="hidden" name="status" value={active} />}
          <div>
            <label htmlFor="f-from" className="label">
              Event from
            </label>
            <input id="f-from" name="from" type="date" defaultValue={from} className="field" />
          </div>
          <div>
            <label htmlFor="f-to" className="label">
              Event until
            </label>
            <input id="f-to" name="to" type="date" defaultValue={to} className="field" />
          </div>
          <div>
            <label htmlFor="f-district" className="label">
              District
            </label>
            <select id="f-district" name="district" defaultValue={districtId ? String(districtId) : ""} className="field">
              <option value="">Any district</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-service" className="label">
              Asked for
            </label>
            <select id="f-service" name="serviceId" defaultValue={serviceId ? String(serviceId) : ""} className="field">
              <option value="">Any offering</option>
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                  {o.kind === "package" ? " (package)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1">
              Apply
            </button>
            {filtered && (
              <Link href={active === "all" ? "/vendor/leads" : `/vendor/leads?status=${active}`} className="btn btn-secondary">
                Clear
              </Link>
            )}
          </div>
        </form>
      </details>

      <section className="card py-1 sm:px-6" aria-label={`${TABS.find((t) => t.key === active)?.label} leads`}>
        {shown.length === 0 ? (
          <EmptyState hasAny={leads.length > 0 || filtered} status={vendor.status} vendorId={vendor.id} />
        ) : (
          shown.map((l) => <LeadRow key={l.id} lead={l} vendorName={vendor.name} />)
        )}
      </section>
      {leads.length >= 200 && (
        <p className="hint mt-3">Showing the latest 200 leads. Use the filters to find older ones.</p>
      )}
    </main>
  );
}

function EmptyState({ hasAny, status, vendorId }: { hasAny: boolean; status: string; vendorId: number }) {
  if (hasAny) {
    return (
      <div className="py-8 text-center">
        <p className="text-body font-medium">No leads match these filters.</p>
        <Link href="/vendor/leads" className="btn btn-ghost btn-sm mt-2">
          Show all leads
        </Link>
      </div>
    );
  }
  const live = status === "approved";
  return (
    <div className="py-10 text-center max-w-[46ch] mx-auto">
      <div aria-hidden="true" className="mx-auto mb-3 size-12 rounded-full bg-accent-tint text-accent grid place-items-center">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z" />
        </svg>
      </div>
      <h2 className="text-title font-semibold">No leads yet</h2>
      <p className="text-body text-ink-soft mt-1">
        {live
          ? "When a customer sends you an enquiry, it shows up here with their event details and what they asked for."
          : "Customers can send enquiries once your listing is live. Finish your listing and submit it for review."}
      </p>
      <div className="flex flex-wrap justify-center gap-2 mt-4">
        {live ? (
          <Link href="/vendor/media" className="btn btn-secondary">
            Add more photos
          </Link>
        ) : (
          <Link href="/vendor" className="btn btn-primary">
            See what&apos;s left
          </Link>
        )}
        <Link href={`/vendors/${vendorId}?preview=1`} className="btn btn-ghost">
          Preview your profile
        </Link>
      </div>
    </div>
  );
}
