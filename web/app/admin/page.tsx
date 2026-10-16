import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { requireAdmin } from "@/lib/admin";
import { findAllVendorsForAdmin, getAdminStats } from "@/lib/db";
import AdminVendors from "./admin-vendors";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const [stats, vendors] = await Promise.all([getAdminStats(), findAllVendorsForAdmin()]);

  return (
    <main className="max-w-[900px] mx-auto px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold mb-1">Admin</h1>
      <p className="text-ink-soft text-sm mb-6">Verify vendors, feature them, or hide a listing from search.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-6">
        {[
          ["Users", stats.users],
          ["Vendors", stats.vendors],
          ["Quote requests", stats.quotes],
          ["Reviews", stats.reviews],
        ].map(([label, num]) => (
          <div key={label} className="border border-line rounded-lg p-4">
            <div className="text-[22px] font-semibold text-accent">{num}</div>
            <div className="text-[12.5px] text-ink-soft mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <AdminVendors
        initialVendors={vendors.map((v) => ({
          id: v.id,
          name: v.name,
          category: v.category,
          location: v.location,
          verified: v.verified,
          featured: v.featured,
          published: v.published,
        }))}
      />
    </main>
  );
}
