import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadOfferingsPage } from "../../_data";
import { BackLink, PackageEditor } from "../../editor-client";

export const metadata: Metadata = { title: "Edit package" };

export default async function EditPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadOfferingsPage();
  const pkg = d.offerings.find((o) => String(o.id) === id && o.kind === "package");
  if (!pkg) notFound();
  const pkgItems = d.packageItems.filter((i) => i.package_id === pkg.id);
  const offUnits = pkgItems
    .map((i) => d.offerings.find((o) => o.id === i.item_id))
    .filter((o) => o && !o.active)
    .map((o) => o!.title);
  // Why the package is hidden: a unit that is off, no units left (they were
  // deleted), or an older state that saving the package clears.
  const incompleteWhy = offUnits.length
    ? `${offUnits.length === 1 ? "one of its units is off" : "some of its units are off"} (${offUnits.join(", ")}). Turn ${offUnits.length === 1 ? "it" : "them"} back on, or remove ${offUnits.length === 1 ? "it" : "them"} from the package and save.`
    : pkgItems.length === 0
      ? "it has no units left. Add at least one unit below and save the package."
      : "a unit was removed from it. Check the units and price below, then save the package.";
  return (
    <main className="page-narrow w-full !mx-0 py-6 sm:py-8">
      <BackLink />
      <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight mt-2 mb-2">{pkg.title}</h1>
      {pkg.incomplete && (
        <p className="mb-6 rounded-control bg-[#fdf3d8] text-gold-ink px-3 py-2 text-sm">
          This package is incomplete, so customers can&apos;t see it: {incompleteWhy}
        </p>
      )}
      <PackageEditor
        tax={d.tax}
        pkg={pkg}
        items={pkgItems}
        units={d.offerings.filter((o) => o.kind !== "package")}
      />
    </main>
  );
}
