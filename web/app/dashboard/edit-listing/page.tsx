import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { findCategories, findDistricts, findVendorByOwner } from "@/lib/db";
import ListingForm from "../create-listing/create-listing-form";

export const metadata: Metadata = { title: "Edit your listing" };

export default async function EditListingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "vendor") redirect("/dashboard");

  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/dashboard/create-listing");

  const [categories, districts] = await Promise.all([findCategories(), findDistricts()]);

  return (
    <main className="max-w-[600px] mx-auto px-4 sm:px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold mb-1">Edit your listing</h1>
      <p className="text-ink-soft text-sm mb-6">
        Update what customers see on your profile.{" "}
        <Link href={`/vendors/${vendor.id}`} className="text-accent hover:underline">
          View public profile
        </Link>
      </p>
      <ListingForm
        mode="edit"
        categories={categories}
        districts={districts.map((d) => ({ id: d.id, name: d.name }))}
        initialValues={{
          vendorId: vendor.id,
          name: vendor.name,
          category: vendor.category,
          location: vendor.location,
          districtId: vendor.district_id,
          phone: vendor.phone,
          whatsapp: vendor.whatsapp,
          price: vendor.price,
          experience: vendor.experience,
          tags: vendor.tags,
          about: vendor.about,
        }}
      />
    </main>
  );
}
