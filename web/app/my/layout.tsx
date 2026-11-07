import type { Metadata } from "next";
import { requirePageRole } from "@/app/api/_lib/auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Customer area guard (PRODUCT_PLAN 2.6). Vendors may open /my/enquiries
// (enquiries they sent as a customer); the proxy sends them away from the
// rest of /my. Admins go to /admin.
export default async function MyLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(["customer", "vendor"]);
  return <>{children}</>;
}
