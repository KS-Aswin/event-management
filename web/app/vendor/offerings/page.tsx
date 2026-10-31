import type { Metadata } from "next";
import { loadOfferingsPage } from "./_data";
import OfferingsManager from "./offerings-manager";

export const metadata: Metadata = { title: "Offerings & packages" };

export default async function OfferingsPage() {
  const d = await loadOfferingsPage();
  return (
    <main className="page py-6 sm:py-8 lg:!px-6">
      <OfferingsManager
        initialOfferings={d.offerings}
        initialItems={d.packageItems}
        limit={d.limit}
        vendorId={d.vendor.id}
      />
    </main>
  );
}
