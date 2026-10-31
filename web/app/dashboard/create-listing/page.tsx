import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import type { Metadata } from "next";
import { findCategories, findDistricts, findVendorByOwner } from "@/lib/db";
import ListingForm from "./create-listing-form";

export const metadata: Metadata = { title: "Create your listing" };

export default async function CreateListingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "vendor") redirect("/dashboard");

  const existing = await findVendorByOwner(session.userId);
  if (existing) redirect("/dashboard");

  const [categories, districts] = await Promise.all([findCategories(), findDistricts()]);

  return (
    <main className="max-w-[600px] mx-auto px-4 sm:px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold mb-1">Create your listing</h1>
      <p className="text-ink-soft text-sm mb-6">
        This is what customers will see when they search for vendors like you.
      </p>
      <ListingForm
        mode="create"
        categories={categories}
        districts={districts.map((d) => ({ id: d.id, name: d.name }))}
      />
    </main>
  );
}
