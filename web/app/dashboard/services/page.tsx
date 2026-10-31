import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { findCategories, findServicesByVendor, findVendorByOwner, SERVICE_PRICE_UNITS } from "@/lib/db";
import ServicesManager from "./services-manager";

export const metadata: Metadata = { title: "Your services" };

export default async function ServicesPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/services");
  if (session.role !== "vendor") redirect("/dashboard");

  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/dashboard/create-listing");

  const [services, categories] = await Promise.all([
    findServicesByVendor(vendor.id, { includeInactive: true }),
    findCategories(),
  ]);

  return (
    <main className="max-w-[600px] mx-auto px-4 sm:px-6 py-10 w-full">
      <Link href="/dashboard" className="text-[13px] text-accent hover:underline">
        ← Dashboard
      </Link>
      <h1 className="text-2xl font-semibold mt-2 mb-1">Your services</h1>
      <p className="text-ink-soft text-sm mb-6">
        What you offer and where your prices start. Customers can pick these when they ask for a quote.
      </p>
      <ServicesManager
        vendorId={vendor.id}
        initialServices={services}
        categories={categories}
        defaultCategory={vendor.category}
        units={[...SERVICE_PRICE_UNITS]}
      />
    </main>
  );
}
