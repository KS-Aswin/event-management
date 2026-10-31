import type { Metadata } from "next";
import { requirePageRole } from "@/app/api/_lib/auth";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Vela admin" },
  robots: { index: false, follow: false },
};

// Admin guard: anyone who is not a live admin gets a plain 404, so the area
// is never revealed (PRODUCT_PLAN 2.6). The proxy does the same by cookie.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("admin");
  return <>{children}</>;
}
