import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage } from "@/app/admin/_components/admin-page";
import { CUSTOM_STATUSES, listCategories, listCustomGroups, listTemplates, type CustomStatus } from "@/lib/admin/taxonomy";
import { CustomQueue } from "./custom-queue";

export const metadata: Metadata = { title: "Custom offerings" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<CustomStatus, string> = {
  pending: "Waiting",
  promoted: "Promoted",
  merged: "Merged",
  kept_private: "Kept private",
  rejected: "Rejected",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = (CUSTOM_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as CustomStatus) : "pending";
  const [groups, categories, templates] = await Promise.all([listCustomGroups(status), listCategories(), listTemplates()]);
  return (
    <AdminPage
      title="Custom offerings"
      eyebrow="Taxonomy"
      description="“Other” offerings vendors typed themselves, grouped by name. The most used come first: promote them into the taxonomy so customers can filter by them."
      actions={
        <Link href="/admin/taxonomy" className="btn btn-secondary">
          Back to taxonomy
        </Link>
      }
    >
      <nav aria-label="Filter by status" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {CUSTOM_STATUSES.map((s) => (
          <Link
            key={s}
            href={s === "pending" ? "/admin/taxonomy/custom" : `/admin/taxonomy/custom?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={`inline-flex min-h-[44px] shrink-0 items-center border-b-2 px-3 text-sm font-medium ${
              s === status ? "border-accent text-accent" : "border-transparent text-ink-soft hover:text-foreground"
            }`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>
      <div className="mt-5">
        <CustomQueue
          key={status}
          status={status}
          groups={groups}
          categories={categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.display_name }))}
          templates={templates
            .filter((t) => t.active && categories.some((c) => c.active && c.id === t.category_id))
            .map((t) => ({ id: t.id, name: t.name, category_id: t.category_id }))}
        />
      </div>
    </AdminPage>
  );
}
