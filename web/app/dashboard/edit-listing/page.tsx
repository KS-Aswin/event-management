import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { findVendorByOwner } from "@/lib/db";
import ListingForm from "../create-listing/create-listing-form";

export default async function EditListingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "vendor") redirect("/dashboard");

  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/dashboard/create-listing");

  return (
    <main className="max-w-[600px] mx-auto px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold mb-1">Edit your listing</h1>
      <p className="text-ink-soft text-sm mb-6">Update what customers see on your profile.</p>
      <ListingForm
        mode="edit"
        initialValues={{
          vendorId: vendor.id,
          name: vendor.name,
          category: vendor.category,
          location: vendor.location,
          price: vendor.price,
          priceUnit: vendor.price_unit,
          experience: vendor.experience,
          tags: vendor.tags,
          about: vendor.about,
        }}
      />
    </main>
  );
}
