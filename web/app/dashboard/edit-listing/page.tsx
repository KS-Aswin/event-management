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
    <main className="page-narrow max-w-[680px] py-8 sm:py-12">
      <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">Edit your listing</h1>
      <p className="text-ink-soft mt-1.5 mb-8 max-w-[56ch]">
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
