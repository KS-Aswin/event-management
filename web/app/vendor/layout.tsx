import type { Metadata } from "next";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findVendorByOwner, pool } from "@/lib/db";
import VendorShell from "@/app/_nav/vendor-shell";

export const metadata: Metadata = {
  title: { default: "Workspace", template: "%s · Vela workspace" },
  robots: { index: false, follow: false },
};

// Vendor workspace guard + frame (PRODUCT_PLAN 2.4, 2.6). The proxy already
// redirected by cookie role; this re-checks against the DB (role, status,
// session_version): anonymous -> /login, customer -> customer home,
// admin -> /admin.
export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const { session } = await requirePageRole("vendor");
  const vendor = await findVendorByOwner(session.userId);

  let newLeads = 0;
  if (vendor) {
    const r = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM quote_requests WHERE vendor_id = $1 AND status = 'pending'",
      [vendor.id]
    );
    newLeads = r.rows[0]?.n ?? 0;
  }

  return (
    <VendorShell
      vendor={vendor ? { id: vendor.id, name: vendor.name, status: vendor.status ?? null } : null}
      newLeads={newLeads}
    >
      {children}
    </VendorShell>
  );
}
