import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { findVendorByOwner } from "@/lib/db";
import { listPackages } from "@/lib/vendor-content";
import PackagesManager from "./packages-manager";

export default async function PackagesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "vendor") redirect("/dashboard");

  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/dashboard/create-listing");

  const packages = await listPackages(vendor.id);

  return (
    <main className="max-w-[600px] mx-auto px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold mb-1">Your packages</h1>
      <p className="text-ink-soft text-sm mb-6">
        Real prices customers see on your public page (up to 6). Packages are shown cheapest first.
      </p>
      <PackagesManager vendorId={vendor.id} initialPackages={packages} />
    </main>
  );
}
