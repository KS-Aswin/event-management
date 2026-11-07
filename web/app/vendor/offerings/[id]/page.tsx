import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadOfferingsPage } from "../_data";
import { BackLink, EditOffering } from "../editor-client";

export const metadata: Metadata = { title: "Edit offering" };

export default async function EditOfferingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadOfferingsPage();
  const offering = d.offerings.find((o) => String(o.id) === id);
  if (!offering) notFound();
  if (offering.kind === "package") redirect(`/vendor/offerings/packages/${offering.id}`);
  return (
    <main className="page-narrow w-full !mx-0 py-6 sm:py-8">
      <BackLink />
      <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight mt-2 mb-6">{offering.title}</h1>
      <EditOffering tax={d.tax} offering={offering} all={d.offerings} />
    </main>
  );
}
