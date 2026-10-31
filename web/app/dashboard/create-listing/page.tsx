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
    <main className="page-narrow max-w-[680px] py-8 sm:py-12">
      <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">Create your listing</h1>
      <p className="text-ink-soft mt-1.5 mb-8 max-w-[56ch]">
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
