import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { findVendorByOwner } from "@/lib/db";
import ListingForm from "./create-listing-form";

export default async function CreateListingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "vendor") redirect("/dashboard");

  const existing = await findVendorByOwner(session.userId);
  if (existing) redirect("/dashboard");

  return (
    <main className="max-w-[600px] mx-auto px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold mb-1">Create your listing</h1>
      <p className="text-ink-soft text-sm mb-6">
        This is what customers will see when they search for vendors like you.
      </p>
      <ListingForm mode="create" />
    </main>
  );
}
