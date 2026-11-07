import type { Metadata } from "next";
import { requirePageRole } from "@/app/api/_lib/auth";
import AdminShell from "@/app/_nav/admin-shell";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Vela admin" },
  robots: { index: false, follow: false },
};

// Every admin page is per-user and must reflect the DB right now.
export const dynamic = "force-dynamic";

// Admin guard: anyone who is not a live admin gets a plain 404, so the area
// is never revealed (PRODUCT_PLAN 2.6). The proxy does the same by cookie
// and sends Cache-Control: private, no-store for /admin.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { session } = await requirePageRole("admin");
  return <AdminShell name={session.name}>{children}</AdminShell>;
}
