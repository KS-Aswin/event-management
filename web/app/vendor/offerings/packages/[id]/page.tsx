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
  return (
    <main className="page-narrow w-full !mx-0 py-6 sm:py-8">
      <BackLink />
      <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight mt-2 mb-2">{pkg.title}</h1>
      {pkg.incomplete && (
        <p className="mb-6 rounded-control bg-[#fdf3d8] text-gold-ink px-3 py-2 text-sm">
          This package is incomplete: one of its units is off, so customers can&apos;t see it. Turn the unit back on or
          remove it from the package.
        </p>
      )}
      <PackageEditor
        tax={d.tax}
        pkg={pkg}
        items={d.packageItems.filter((i) => i.package_id === pkg.id)}
        units={d.offerings.filter((o) => o.kind !== "package")}
      />
    </main>
  );
}
