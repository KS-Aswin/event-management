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
    <main className="page-narrow max-w-[680px] py-8 sm:py-12">
      <Link href="/dashboard" className="btn btn-ghost btn-sm -ml-3.5">
        ← Dashboard
      </Link>
      <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight mt-1">Your services</h1>
      <p className="text-ink-soft mt-1.5 mb-8 max-w-[56ch]">
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
