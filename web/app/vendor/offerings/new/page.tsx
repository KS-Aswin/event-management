import type { Metadata } from "next";
import { loadOfferingsPage } from "../_data";
import { BackLink, NewOffering } from "../editor-client";

export const metadata: Metadata = { title: "Add an offering" };

export default async function NewOfferingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadOfferingsPage();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tid = Number(one(sp.template));
  const templateId = Number.isInteger(tid) && d.tax.templates.some((t) => t.id === tid) ? tid : null;
  const kind = one(sp.kind) === "addon" ? "addon" : "unit";
  return (
    <main className="page-narrow w-full !mx-0 py-6 sm:py-8">
      <BackLink />
      <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight mt-2 mb-6">
        {kind === "addon" ? "Add an add-on" : "Add an offering"}
      </h1>
      <NewOffering tax={d.tax} categoryIds={d.categoryIds} all={d.offerings} initialTemplateId={templateId} initialKind={kind} />
    </main>
  );
}
