import type { Metadata } from "next";
import { loadOfferingsPage } from "../../_data";
import { BackLink, PackageEditor } from "../../editor-client";

export const metadata: Metadata = { title: "New package" };

export default async function NewPackagePage() {
  const d = await loadOfferingsPage();
  return (
    <main className="page-narrow w-full !mx-0 py-6 sm:py-8">
      <BackLink />
      <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight mt-2">New package</h1>
      <p className="text-ink-soft text-lead mt-1 mb-6">Bundle your offerings into one price customers can enquire about.</p>
      <PackageEditor tax={d.tax} pkg={null} items={[]} units={d.offerings.filter((o) => o.kind !== "package")} />
    </main>
  );
}
