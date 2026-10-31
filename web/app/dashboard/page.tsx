import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  findVendorByOwner,
  findQuoteRequestsByVendor,
  findQuoteRequestsByCustomer,
  findFavoritesByCustomer,
  findServicesByVendor,
  findDistricts,
  type VendorRecord,
  type LeadRecord,
  type QuoteRequestWithVendor,
  type FavoriteVendor,
  type ServiceRecord,
} from "@/lib/db";
import { LeadRow, MyRequestsAndFavorites } from "./lead-list";

export const metadata: Metadata = { title: "Dashboard" };

const RECENT_LEADS = 8;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;

  const firstName = session.name.split(" ")[0];
  const isVendor = session.role === "vendor";

  // The signed-in user's own outgoing requests and saves. Vendors can hire
  // other vendors too, so these are loaded for every role.
  const [vendor, quotes, favorites] = await Promise.all([
    isVendor ? findVendorByOwner(session.userId) : Promise.resolve(null),
    findQuoteRequestsByCustomer(session.userId),
    findFavoritesByCustomer(session.userId),
  ]);

  // "Welcome back" only once there's something to come back to.
  const isNew = isVendor ? !vendor : quotes.length === 0 && favorites.length === 0;
  const greeting = isNew ? `Welcome, ${firstName}` : `Welcome back, ${firstName}`;

  let banner: string | null = null;
  if (sp.created === "1") banner = "Your listing is live. Customers can now find you in search.";
  else if (sp.updated === "1") banner = "Listing updated.";

  return (
    <main className="page-narrow py-8 sm:py-12">
      {banner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 mb-6 text-sm text-accent-hover bg-accent-tint border border-accent/30 rounded-card pl-4 pr-1 py-1"
        >
          <span>{banner}</span>
          <Link href="/dashboard" aria-label="Dismiss" className="inline-flex items-center justify-center w-11 h-11 rounded-control text-accent hover:bg-white/60 shrink-0">
            ✕
          </Link>
        </div>
      )}
      <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">{greeting}</h1>

      {isVendor ? (
        <VendorDashboard vendor={vendor} quotes={quotes} favorites={favorites} />
      ) : (
        <>
          <p className="text-ink-soft mt-1.5 mb-8">Track your quote requests and saved vendors.</p>
          <MyRequestsAndFavorites quotes={quotes} favorites={favorites} />
          <Link href="/search" className="btn btn-primary w-full sm:w-auto mt-2">
            Browse vendors
          </Link>
        </>
      )}
    </main>
  );
}

async function VendorDashboard({
  vendor,
  quotes,
  favorites,
}: {
  vendor: VendorRecord | null;
  quotes: QuoteRequestWithVendor[];
  favorites: FavoriteVendor[];
}) {
  if (!vendor) {
    return (
      <>
        <div className="card sm:p-7 mt-6 mb-10">
          <h2 className="text-lg font-semibold">Get found by customers</h2>
          <p className="text-ink-soft mt-1.5 mb-5 max-w-[52ch]">
            You don&apos;t have a business listing yet — customers can&apos;t find you until you create one.
          </p>
          <Link href="/dashboard/create-listing" className="btn btn-primary btn-lg w-full sm:w-auto">
            Create your listing
          </Link>
        </div>
        {(quotes.length > 0 || favorites.length > 0) && (
          <MyRequestsAndFavorites quotes={quotes} favorites={favorites} />
        )}
      </>
    );
  }

  const [leads, services, districts] = await Promise.all([
    findQuoteRequestsByVendor(vendor.id),
    findServicesByVendor(vendor.id, { includeInactive: true }),
    vendor.district_id ? findDistricts() : Promise.resolve([]),
  ]);
  const pendingCount = leads.filter((l) => l.status === "pending").length;
  const replyRate = leads.length > 0 ? Math.round(((leads.length - pendingCount) / leads.length) * 100) : null;
  const district = districts.find((d) => d.id === vendor.district_id)?.name ?? vendor.location;

  return (
    <>
      <p className="text-ink-soft mt-1.5">
        <span className="font-medium text-foreground">{vendor.name}</span> · {vendor.category} · {district}
      </p>
      <div className="flex flex-wrap gap-2 mt-4 mb-8">
        <Link href="/dashboard/edit-listing" className="btn btn-secondary btn-sm">
          Edit listing
        </Link>
        <Link href="/dashboard/services" className="btn btn-secondary btn-sm">
          Services
        </Link>
        <Link href={`/vendors/${vendor.id}`} className="btn btn-ghost btn-sm">
          View public profile
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      {pendingCount > 0 && (
        <Link
          href="/dashboard/leads?status=pending"
          className="flex items-center justify-between gap-3 mb-4 rounded-card border border-gold bg-amber-50 px-4 py-3.5 text-sm hover:bg-amber-100 transition-colors"
        >
          <span>
            <span className="font-semibold">
              {pendingCount} new {pendingCount === 1 ? "enquiry" : "enquiries"}
            </span>{" "}
            waiting for your reply. Customers usually book whoever answers first.
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      <OnboardingChecklist vendor={vendor} services={services} />

      <h2 className="sr-only">Your numbers</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat num={String(leads.length)} label="Total leads" href="/dashboard/leads" />
        <Stat num={String(pendingCount)} label="Awaiting reply" href="/dashboard/leads?status=pending" />
        <Stat num={replyRate === null ? "—" : `${replyRate}%`} label="Reply rate" />
        <Stat num={String(vendor.reviews_count)} label="Reviews" href={`/vendors/${vendor.id}`} />
      </div>

      <div className="card sm:px-6 mb-10">
        <div className="flex items-center justify-between gap-2 min-h-11 -mt-1.5">
          <h2 className="text-base font-semibold">Recent enquiries</h2>
          {leads.length > 0 && (
            <Link href="/dashboard/leads" className="btn btn-ghost btn-sm -mr-3">
              {leads.length > RECENT_LEADS ? `See all ${leads.length}` : "See all"}
            </Link>
          )}
        </div>
        {leads.length === 0 ? (
          <p className="text-sm text-ink-soft mt-1.5 max-w-[60ch]">
            No quote requests yet. Once your listing is live, customer enquiries will show up here.
          </p>
        ) : (
          <LeadRows leads={leads.slice(0, RECENT_LEADS)} />
        )}
      </div>

      {(quotes.length > 0 || favorites.length > 0) && (
        <section aria-labelledby="my-requests">
          <h2 id="my-requests" className="text-lg font-semibold mb-1">
            Your quote requests and favourites
          </h2>
          <p className="text-sm text-ink-soft mb-5">Vendors you contacted or saved while planning your own events.</p>
          <MyRequestsAndFavorites quotes={quotes} favorites={favorites} headingLevel="h3" />
        </section>
      )}
    </>
  );
}

function LeadRows({ leads }: { leads: LeadRecord[] }) {
  return (
    <>
      {leads.map((l, i) => (
        <LeadRow key={l.id} lead={l} last={i === leads.length - 1} />
      ))}
    </>
  );
}

function OnboardingChecklist({ vendor, services }: { vendor: VendorRecord; services: ServiceRecord[] }) {
  const items = [
    { done: true, label: "Create your listing", href: "/dashboard/edit-listing" },
    { done: !!vendor.district_id, label: "Choose your district so local customers find you", href: "/dashboard/edit-listing" },
    { done: !!(vendor.phone || vendor.whatsapp), label: "Add a phone or WhatsApp number", href: "/dashboard/edit-listing" },
    { done: vendor.about.trim().length >= 80, label: "Describe your business in a few sentences", href: "/dashboard/edit-listing" },
    { done: vendor.tags.length >= 2, label: "Add a few tags (e.g. Candid, Drone)", href: "/dashboard/edit-listing" },
    { done: services.some((s) => s.active), label: "List at least one service with a price", href: "/dashboard/services" },
  ];
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  return (
    <div className="card sm:px-6 mb-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Complete your profile</h2>
        <span className="text-sm font-semibold text-accent tabular-nums" aria-hidden="true">
          {Math.round((doneCount / items.length) * 100)}%
        </span>
      </div>
      <p className="text-[13px] text-ink-soft mt-0.5 mb-3">
        {doneCount} of {items.length} done. Complete profiles get more enquiries.
      </p>
      <div
        className="h-2 rounded-full bg-line mb-2 overflow-hidden"
        role="progressbar"
        aria-label="Profile strength"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={doneCount}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${(doneCount / items.length) * 100}%` }} />
      </div>
      <ul className="text-sm -mb-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-3 min-h-11 border-b border-line last:border-b-0">
            <span
              aria-hidden="true"
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 border ${
                item.done ? "bg-accent border-accent text-white" : "border-[#80868b] bg-white"
              }`}
            >
              {item.done ? (
                <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8.5l3 3 6-6.5" />
                </svg>
              ) : null}
            </span>
            {item.done ? (
              <span className="text-ink-soft line-through decoration-ink-soft/50 py-2">
                {item.label}
                <span className="sr-only"> (done)</span>
              </span>
            ) : (
              <Link href={item.href} className="flex-1 flex items-center justify-between gap-2 min-h-11 py-2 font-medium text-accent hover:underline">
                {item.label}
                <span aria-hidden="true" className="text-ink-soft">→</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ num, label, href }: { num: string; label: string; href?: string }) {
  const body = (
    <>
      <div className="text-2xl sm:text-[28px] leading-tight font-semibold text-accent tabular-nums">{num}</div>
      <div className="text-[13px] text-ink-soft mt-1">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className="card card-link block p-4 hover:border-accent">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}
