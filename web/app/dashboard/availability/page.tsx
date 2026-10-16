import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { findVendorByOwner } from "@/lib/db";
import { listUnavailableDates } from "@/lib/vendor-content";
import AvailabilityManager from "./availability-manager";

export default async function AvailabilityPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "vendor") redirect("/dashboard");

  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/dashboard/create-listing");

  const dates = await listUnavailableDates(vendor.id);

  return (
    <main className="max-w-[600px] mx-auto px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold mb-1">Availability</h1>
      <p className="text-ink-soft text-sm mb-6">
        Block the dates you can&apos;t take work. Customers can&apos;t request a quote for these days. Dates
        are blocked automatically when you mark a request as booked.
      </p>
      <AvailabilityManager vendorId={vendor.id} initialDates={dates} />
    </main>
  );
}
