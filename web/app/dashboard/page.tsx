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
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 w-full">
      {banner && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 mb-5 text-sm text-accent bg-accent-tint border border-accent/30 rounded-md px-3.5 py-2.5"
        >
          <span>{banner}</span>
          <Link href="/dashboard" aria-label="Dismiss" className="text-accent hover:underline shrink-0">
            ✕
          </Link>
        </div>
      )}
      <h1 className="text-2xl font-semibold">{greeting}</h1>

      {isVendor ? (
        <VendorDashboard vendor={vendor} quotes={quotes} favorites={favorites} />
      ) : (
        <>
          <p className="text-ink-soft text-sm mt-1 mb-6">Track your quote requests and saved vendors.</p>
          <MyRequestsAndFavorites quotes={quotes} favorites={favorites} />
          <Link
            href="/search"
            className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm inline-block"
          >
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
        <p className="text-ink-soft text-sm mt-1 mb-6">
          You don&apos;t have a business listing yet — customers can&apos;t find you until you create one.
        </p>
        <Link
          href="/dashboard/create-listing"
          className="inline-block px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium mb-8"
        >
          Create your listing
        </Link>
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
      <p className="text-ink-soft text-sm mt-1 mb-6">
        <span className="font-medium text-accent">{vendor.name}</span> · {vendor.category} · {district}
        {" · "}
        <Link href="/dashboard/edit-listing" className="text-accent hover:underline">
          Edit listing
        </Link>
        {" · "}
        <Link href="/dashboard/services" className="text-accent hover:underline">
          Services
        </Link>
        {" · "}
        <Link href={`/vendors/${vendor.id}`} className="text-accent hover:underline">
          View public profile
        </Link>
      </p>

      {pendingCount > 0 && (
        <Link
          href="/dashboard/leads?status=pending"
          className="flex items-center justify-between gap-3 mb-4 rounded-xl border border-gold bg-amber-50 px-4 py-3 text-sm hover:bg-amber-100"
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-4">
        <Stat num={String(leads.length)} label="Total leads" href="/dashboard/leads" />
        <Stat num={String(pendingCount)} label="Awaiting reply" href="/dashboard/leads?status=pending" />
        <Stat num={replyRate === null ? "—" : `${replyRate}%`} label="Reply rate" />
        <Stat num={String(vendor.reviews_count)} label="Reviews" href={`/vendors/${vendor.id}`} />
      </div>

      <div className="border border-line rounded-xl p-5.5 mb-8">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="text-[15px] font-semibold">Recent enquiries</h2>
          {leads.length > 0 && (
            <Link href="/dashboard/leads" className="text-[13px] text-accent hover:underline">
              {leads.length > RECENT_LEADS ? `See all ${leads.length}` : "See all"}
            </Link>
          )}
        </div>
        {leads.length === 0 ? (
          <p className="text-sm text-ink-soft mt-1.5">
            No quote requests yet. Once your listing is live, customer enquiries will show up here.
          </p>
        ) : (
          <LeadRows leads={leads.slice(0, RECENT_LEADS)} />
        )}
      </div>

      {(quotes.length > 0 || favorites.length > 0) && (
        <section aria-labelledby="my-requests">
          <h2 id="my-requests" className="text-[15px] font-semibold mb-1">
            Your quote requests and favourites
          </h2>
          <p className="text-xs text-ink-soft mb-3">Vendors you contacted or saved while planning your own events.</p>
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
    <div className="border border-line rounded-xl p-5.5 mb-4">
      <h2 className="text-[15px] font-semibold">Complete your profile</h2>
      <p className="text-xs text-ink-soft mt-0.5 mb-2.5">
        {doneCount} of {items.length} done. Complete profiles get more enquiries.
      </p>
      <div
        className="h-1.5 rounded-full bg-line mb-3 overflow-hidden"
        role="progressbar"
        aria-label="Profile strength"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={doneCount}
      >
        <div className="h-full bg-accent" style={{ width: `${(doneCount / items.length) * 100}%` }} />
      </div>
      <ul className="space-y-1.5 text-sm">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`w-4 h-4 rounded-full shrink-0 border text-[10px] leading-[14px] text-center ${
                item.done ? "bg-accent border-accent text-white" : "border-[#80868b]"
              }`}
            >
              {item.done ? "✓" : ""}
            </span>
            {item.done ? (
              <span className="text-ink-soft line-through">
                {item.label}
                <span className="sr-only"> (done)</span>
              </span>
            ) : (
              <Link href={item.href} className="text-accent hover:underline">
                {item.label}
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
      <div className="text-[22px] font-semibold text-accent">{num}</div>
      <div className="text-[12.5px] text-ink-soft mt-0.5">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className="block border border-line rounded-lg p-4 hover:border-accent">
      {body}
    </Link>
  ) : (
    <div className="border border-line rounded-lg p-4">{body}</div>
  );
}
