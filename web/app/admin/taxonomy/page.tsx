import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage } from "@/app/admin/_components/admin-page";
import { countPendingCustom, listCategories, listEventTypes, listTemplates } from "@/lib/admin/taxonomy";
import { TaxonomyManager, type TaxTab } from "./_components/taxonomy-manager";

export const metadata: Metadata = { title: "Taxonomy" };
export const dynamic = "force-dynamic";

const TABS: TaxTab[] = ["categories", "templates", "event-types"];

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; category?: string }> }) {
  const sp = await searchParams;
  const tab = (TABS as string[]).includes(sp.tab ?? "") ? (sp.tab as TaxTab) : "categories";
  const [categories, templates, eventTypes, pendingCustom] = await Promise.all([
    listCategories(),
    listTemplates(),
    listEventTypes(),
    countPendingCustom(),
  ]);
  const cat = Number(sp.category);
  return (
    <AdminPage
      title="Taxonomy"
      description="Categories, offering templates and event types. Changes reach the vendor offering picker and search filters straight away."
      actions={
        <Link href="/admin/taxonomy/custom" className="btn btn-secondary">
          Custom offerings
          {pendingCustom > 0 && (
            <span className="chip bg-gold/15 text-gold-ink" aria-label={`${pendingCustom} waiting`}>
              {pendingCustom}
            </span>
          )}
        </Link>
      }
    >
      <TaxonomyManager
        initialTab={tab}
        initialCategoryId={Number.isInteger(cat) && cat > 0 ? cat : null}
        initial={{ categories, templates, eventTypes }}
      />
    </AdminPage>
  );
}
