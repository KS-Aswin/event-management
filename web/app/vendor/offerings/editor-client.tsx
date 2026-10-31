"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import OfferingUnitForm, { type NewOfferingSpec } from "@/app/vendor/_components/offering-unit-form";
import OfferingPackageForm from "@/app/vendor/_components/offering-package-form";
import { categoryName, type Offering, type PackageItem, type TaxonomyLite } from "@/app/vendor/_components/offering-api";

// Client wrappers for the offering / package editor pages.

export function BackLink() {
  return (
    <Link href="/vendor/offerings" className="inline-flex items-center gap-1 min-h-11 text-sm text-ink-soft hover:text-accent">
      <span aria-hidden>←</span> Offerings &amp; packages
    </Link>
  );
}

export function EditOffering({ tax, offering, all }: { tax: TaxonomyLite; offering: Offering; all: Offering[] }) {
  const router = useRouter();
  return (
    <OfferingUnitForm
      tax={tax}
      offering={offering}
      variant="full"
      allOfferings={all}
      submitLabel="Save changes"
      onCancel={() => router.push("/vendor/offerings")}
      onSaved={() => router.refresh()}
    />
  );
}

export function PackageEditor({
  tax,
  pkg,
  items,
  units,
}: {
  tax: TaxonomyLite;
  pkg: Offering | null;
  items: PackageItem[];
  units: Offering[];
}) {
  const router = useRouter();
  return (
    <OfferingPackageForm
      tax={tax}
      pkg={pkg}
      items={items}
      units={units}
      onCancel={() => router.push("/vendor/offerings")}
      onSaved={() => {
        router.push("/vendor/offerings");
        router.refresh();
      }}
    />
  );
}

/** Choose a standard offering (or Other) in one of the vendor's categories, then fill in the details. */
export function NewOffering({
  tax,
  categoryIds,
  all,
  initialTemplateId,
  initialKind,
}: {
  tax: TaxonomyLite;
  categoryIds: number[];
  all: Offering[];
  initialTemplateId: number | null;
  initialKind: "unit" | "addon";
}) {
  const router = useRouter();
  const uid = useId();
  const initialTemplate = initialTemplateId ? tax.templates.find((t) => t.id === initialTemplateId) : undefined;
  const ordered = [
    ...categoryIds.map((id) => tax.categories.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c),
    ...tax.categories.filter((c) => !categoryIds.includes(c.id)),
  ];
  const [categoryId, setCategoryId] = useState<number>(initialTemplate?.category_id ?? ordered[0]?.id ?? 0);
  const [kind, setKind] = useState<"unit" | "addon">(initialTemplate?.kind ?? initialKind);
  const [choice, setChoice] = useState<string>(initialTemplate ? `t${initialTemplate.id}` : "");
  const [otherName, setOtherName] = useState("");
  const [spec, setSpec] = useState<NewOfferingSpec | null>(
    initialTemplate ? { templateId: initialTemplate.id, categoryId: initialTemplate.category_id, kind: initialTemplate.kind } : null
  );
  const [err, setErr] = useState<string | null>(null);
  const hasParents = all.some((o) => o.kind !== "addon");

  const templates = tax.templates.filter((t) => t.category_id === categoryId && t.kind === kind);
  const taken = new Set(all.map((o) => o.template_id).filter(Boolean));

  function proceed(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (kind === "addon" && !hasParents) return setErr("Add an offering first: add-ons attach to one of your offerings.");
    if (!choice) return setErr("Choose an offering, or pick Other and type a name.");
    if (choice === "other") {
      const name = otherName.trim();
      if (name.length < 2) return setErr("Type a name for your offering.");
      setSpec({ templateId: null, categoryId, customName: name, kind });
      return;
    }
    const t = tax.templates.find((x) => `t${x.id}` === choice);
    if (t) setSpec({ templateId: t.id, categoryId: t.category_id, kind: t.kind });
  }

  if (spec) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink-soft">
          {categoryName(tax, spec.categoryId)} ·{" "}
          <button type="button" className="text-accent hover:underline underline-offset-2 min-h-11" onClick={() => setSpec(null)}>
            change
          </button>
        </p>
        <OfferingUnitForm
          key={`${spec.templateId}-${spec.customName}`}
          tax={tax}
          spec={spec}
          variant="full"
          allOfferings={all}
          submitLabel={kind === "addon" ? "Add add-on" : "Add offering"}
          onCancel={() => router.push("/vendor/offerings")}
          onSaved={() => {
            router.push("/vendor/offerings");
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <form onSubmit={proceed} noValidate className="flex flex-col gap-5">
      <fieldset>
        <legend className="label">Type</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["unit", "Offering"],
              ["addon", "Add-on to an offering"],
            ] as const
          ).map(([v, l]) => (
            <label
              key={v}
              className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-control border text-sm cursor-pointer ${
                kind === v ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong"
              }`}
            >
              <input
                type="radio"
                name={`${uid}-kind`}
                className="h-4 w-4 accent-[var(--color-accent)]"
                checked={kind === v}
                onChange={() => {
                  setKind(v);
                  setChoice("");
                }}
              />
              {l}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${uid}-cat`} className="label">
          Category
        </label>
        <select
          id={`${uid}-cat`}
          className="field"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(Number(e.target.value));
            setChoice("");
          }}
        >
          {ordered.map((c, i) => (
            <option key={c.id} value={c.id}>
              {c.display_name || c.name}
              {i < categoryIds.length ? " (yours)" : ""}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="label">What is it?</legend>
        <ul className="flex flex-col gap-1">
          {templates.map((t) => (
            <li key={t.id}>
              <label className="flex items-center gap-3 min-h-11 px-2 -mx-2 rounded-control cursor-pointer hover:bg-surface-muted">
                <input
                  type="radio"
                  name={`${uid}-tpl`}
                  className="h-5 w-5 accent-[var(--color-accent)]"
                  checked={choice === `t${t.id}`}
                  onChange={() => setChoice(`t${t.id}`)}
                />
                <span className="text-sm">{t.name}</span>
                {taken.has(t.id) && <span className="chip">You have this</span>}
              </label>
            </li>
          ))}
          <li>
            <label className="flex items-center gap-3 min-h-11 px-2 -mx-2 rounded-control cursor-pointer hover:bg-surface-muted">
              <input
                type="radio"
                name={`${uid}-tpl`}
                className="h-5 w-5 accent-[var(--color-accent)]"
                checked={choice === "other"}
                onChange={() => setChoice("other")}
              />
              <span className="text-sm">Other (type your own)</span>
            </label>
            {choice === "other" && (
              <div className="ml-8 mt-1">
                <label htmlFor={`${uid}-other`} className="sr-only">
                  Name of your offering
                </label>
                <input
                  id={`${uid}-other`}
                  className="field"
                  maxLength={120}
                  placeholder="e.g. Kolkali team"
                  value={otherName}
                  onChange={(e) => setOtherName(e.target.value)}
                />
                <p className="hint">Our team reviews new names and may add them to the list for everyone.</p>
              </div>
            )}
          </li>
        </ul>
      </fieldset>

      {err && (
        <p className="alert-error" role="alert">
          {err}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary">
          Continue
        </button>
        <Link href="/vendor/offerings" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
