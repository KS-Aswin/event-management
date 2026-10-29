import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { findVendorByOwner, findQuoteRequestsByVendor, findQuoteRequestsByCustomer, findFavoritesByCustomer } from "@/lib/db";
import LeadStatusControl from "./lead-status-control";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const firstName = session.name.split(" ")[0];

  return (
    <main className="max-w-2xl mx-auto px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold">Welcome back, {firstName}</h1>

      {session.role === "vendor" ? (
        <VendorDashboard userId={session.userId} />
      ) : (
        <CustomerDashboard userId={session.userId} />
      )}
    </main>
  );
}

async function VendorDashboard({ userId }: { userId: number }) {
  const vendor = await findVendorByOwner(userId);

  if (!vendor) {
    return (
      <>
        <p className="text-ink-soft text-sm mt-1 mb-6">
          You don&apos;t have a business listing yet — customers can&apos;t find you until you create one.
        </p>
        <Link
          href="/dashboard/create-listing"
          className="inline-block px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium"
        >
          Create your listing
        </Link>
      </>
    );
  }

  const leads = await findQuoteRequestsByVendor(vendor.id);
  const pendingCount = leads.filter((l) => l.status === "pending").length;

  return (
    <>
      <p className="text-ink-soft text-sm mt-1 mb-6">
        Real stats for <span className="font-medium text-accent">{vendor.name}</span>.{" "}
        <Link href="/dashboard/edit-listing" className="text-accent hover:underline">
          Edit listing
        </Link>
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 mb-4">
        <Stat num={String(leads.length)} label="Total leads" />
        <Stat num={String(pendingCount)} label="Awaiting reply" />
        <Stat num={String(vendor.reviews_count)} label="Reviews" />
      </div>

      <div className="border border-line rounded-xl p-5.5 mb-4">
        <h3 className="text-[15px] font-semibold mb-2.5">Recent enquiries</h3>
        {leads.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No quote requests yet. Once your listing is live, customer enquiries will show up here.
          </p>
        ) : (
          leads.slice(0, 8).map((l, i) => (
            <div
              key={l.id}
              className={`flex items-start justify-between gap-2.5 py-2 text-sm ${
                i < Math.min(leads.length, 8) - 1 ? "border-b border-line" : ""
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                    l.status === "pending" ? "bg-gold" : "bg-accent"
                  }`}
                />
                <div className="min-w-0">
                  <span className="font-medium">{l.name}</span>
                  {l.event_date ? ` — event on ${new Date(l.event_date).toLocaleDateString("en-IN")}` : ""}
                  {l.budget ? ` — budget ₹${l.budget}` : ""}
                  {l.services && l.services.length > 0 ? (
                    <div className="text-xs mt-0.5">Wants: {l.services.join(", ")}</div>
                  ) : null}
                  <div className="text-ink-soft text-xs mt-0.5">
                    {l.phone} · {new Date(l.created_at).toLocaleDateString("en-IN")}
                  </div>
                </div>
              </div>
              <LeadStatusControl quoteId={l.id} status={l.status} />
            </div>
          ))
        )}
      </div>
      <p className="text-xs text-ink-soft mb-4">
        &quot;Profile visitors&quot; and &quot;conversion rate&quot; aren&apos;t shown because there&apos;s no
        page-view tracking built yet — these numbers are real counts from actual quote requests, not
        sample data.
      </p>
    </>
  );
}

async function CustomerDashboard({ userId }: { userId: number }) {
  const [quotes, favorites] = await Promise.all([
    findQuoteRequestsByCustomer(userId),
    findFavoritesByCustomer(userId),
  ]);

  return (
    <>
      <p className="text-ink-soft text-sm mt-1 mb-6">Your quote requests.</p>

      {quotes.length === 0 ? (
        <div className="border border-line rounded-xl p-5.5 mb-4 text-sm text-ink-soft">
          You haven&apos;t requested any quotes yet.{" "}
          <Link href="/search" className="text-accent hover:underline">
            Browse vendors
          </Link>{" "}
          to get started.
        </div>
      ) : (
        <div className="border border-line rounded-xl p-5.5 mb-4">
          {quotes.map((q, i) => (
            <div
              key={q.id}
              className={`flex items-start gap-2.5 py-2.5 text-sm ${
                i < quotes.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                  q.status === "pending" ? "bg-gold" : "bg-accent"
                }`}
              />
              <div>
                <Link href={`/vendors/${q.vendor_id}`} className="font-medium hover:underline">
                  {q.vendor_name}
                </Link>{" "}
                <span className="text-ink-soft">({q.vendor_category})</span>
                {q.event_date ? ` — event on ${new Date(q.event_date).toLocaleDateString("en-IN")}` : ""}
                <div className="text-ink-soft text-xs mt-0.5">
                  Requested {new Date(q.created_at).toLocaleDateString("en-IN")} · status: {q.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="text-[15px] font-semibold mb-2.5">Your favorites</h3>
      {favorites.length === 0 ? (
        <p className="text-sm text-ink-soft mb-6">
          No saved vendors yet. Tap the heart icon on a vendor to save them here for later.
        </p>
      ) : (
        <div className="border border-line rounded-xl p-5.5 mb-6">
          {favorites.map((f, i) => (
            <div
              key={f.id}
              className={`flex items-center justify-between gap-2.5 py-2.5 text-sm ${
                i < favorites.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <div>
                <Link href={`/vendors/${f.id}`} className="font-medium hover:underline">
                  {f.name}
                </Link>{" "}
                <span className="text-ink-soft">
                  ({f.category} · {f.location})
                </span>
              </div>
              <span className="text-xs text-ink-soft">{f.price_label}</span>
            </div>
          ))}
        </div>
      )}

      <Link href="/search" className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm inline-block">
        Browse vendors
      </Link>
    </>
  );
}

function Stat({ num, label }: { num: string; label: string }) {
  return (
    <div className="border border-line rounded-lg p-4">
      <div className="text-[22px] font-semibold text-accent">{num}</div>
      <div className="text-[12.5px] text-ink-soft mt-0.5">{label}</div>
    </div>
  );
}
