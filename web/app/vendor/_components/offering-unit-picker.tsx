"use client";

import { useId, useState } from "react";
import type { TaxonomyLite, TemplateLite } from "./offering-api";

// Checklist of standard offerings (templates) for the chosen categories, with
// "Other" to add a custom one. For an Event Management company it also lists
// the core unit of every other category (the EM checklist, PRODUCT_PLAN 3.3),
// so each unit is listed under its own category.

export interface PickedUnit {
  key: string;
  templateId: number | null;
  categoryId: number;
  customName?: string;
  saleMode: "separate" | "package_only";
  fulfilment: "in_house" | "partner";
}

export default function OfferingUnitPicker({
  tax,
  categoryIds,
  eventCompany,
  existingTemplateIds,
  picked,
  onChange,
}: {
  tax: TaxonomyLite;
  /** Chosen categories, primary first. */
  categoryIds: number[];
  /** Primary category is Event Management: show the cross-category checklist. */
  eventCompany: boolean;
  /** Templates the vendor already has an offering for. */
  existingTemplateIds: number[];
  picked: PickedUnit[];
  onChange: (next: PickedUnit[]) => void;
}) {
  const uid = useId();
  const [otherDraft, setOtherDraft] = useState<Record<number, string>>({});
  const [otherErr, setOtherErr] = useState<Record<number, string>>({});

  const unitTemplates = (catId: number, coreOnly = false) =>
    tax.templates.filter((t) => t.category_id === catId && t.kind === "unit" && (!coreOnly || t.is_core));

  const groups: { categoryId: number; templates: TemplateLite[]; core: boolean }[] = categoryIds.map((id) => ({
    categoryId: id,
    templates: unitTemplates(id),
    core: false,
  }));
  if (eventCompany) {
    for (const c of tax.categories) {
      if (categoryIds.includes(c.id)) continue;
      const core = unitTemplates(c.id, true);
      if (core.length) groups.push({ categoryId: c.id, templates: core, core: true });
    }
  }

  const isPicked = (tid: number) => picked.some((p) => p.templateId === tid);
  const toggle = (t: TemplateLite, on: boolean) => {
    if (on) {
      onChange([
        ...picked,
        { key: `t${t.id}`, templateId: t.id, categoryId: t.category_id, saleMode: "separate", fulfilment: "in_house" },
      ]);
    } else onChange(picked.filter((p) => p.templateId !== t.id));
  };
  const patch = (key: string, p: Partial<PickedUnit>) => onChange(picked.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const addOther = (catId: number) => {
    const name = (otherDraft[catId] ?? "").trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      setOtherErr({ ...otherErr, [catId]: "Type a name of at least 2 letters." });
      return;
    }
    if (picked.some((p) => p.categoryId === catId && p.customName?.toLowerCase() === name.toLowerCase())) {
      setOtherErr({ ...otherErr, [catId]: "You've already added that." });
      return;
    }
    onChange([
      ...picked,
      { key: `c${catId}-${name.toLowerCase()}`, templateId: null, categoryId: catId, customName: name, saleMode: "separate", fulfilment: "in_house" },
    ]);
    setOtherDraft({ ...otherDraft, [catId]: "" });
    setOtherErr({ ...otherErr, [catId]: "" });
  };

  const catName = (id: number) => {
    const c = tax.categories.find((x) => x.id === id);
    return c?.display_name || c?.name || "";
  };

  const renderOptions = (p: PickedUnit) => (
    <div className="mt-2 ml-8 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
        <Segmented
          name={`${uid}-${p.key}-sale`}
          label="Booking"
          value={p.saleMode}
          options={[
            ["separate", "Bookable separately"],
            ["package_only", "Package only"],
          ]}
          onChange={(v) => patch(p.key, { saleMode: v as PickedUnit["saleMode"] })}
        />

        <Segmented
          name={`${uid}-${p.key}-ful`}
          label="Done by"
          value={p.fulfilment}
          options={[
            ["in_house", "In-house"],
            ["partner", "Partner"],
          ]}
          onChange={(v) => patch(p.key, { fulfilment: v as PickedUnit["fulfilment"] })}
        />

    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g, gi) => {
        const showCoreHeading = g.core && (gi === 0 || !groups[gi - 1].core);
        const customs = picked.filter((p) => !p.templateId && p.categoryId === g.categoryId);
        return (
          <div key={g.categoryId}>
            {showCoreHeading && (
              <div className="mb-4 pt-2 border-t border-line">
                <h3 className="text-title font-semibold mt-4">Services you arrange from other categories</h3>
                <p className="text-body text-ink-soft">
                  Tick what your company can provide. Each one is listed in its own category, so customers searching for
                  photography can find your photography unit.
                </p>
              </div>
            )}
            <fieldset>
              <legend className="text-sm font-semibold mb-2">{catName(g.categoryId)}</legend>
              <ul className="flex flex-col gap-1">
                {g.templates.map((t) => {
                  const existing = existingTemplateIds.includes(t.id);
                  const on = existing || isPicked(t.id);
                  const p = picked.find((x) => x.templateId === t.id);
                  return (
                    <li key={t.id}>
                      <label className={`flex items-center gap-3 min-h-11 px-2 -mx-2 rounded-control ${existing ? "" : "cursor-pointer hover:bg-surface-muted"}`}>
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                          checked={on}
                          disabled={existing}
                          onChange={(e) => toggle(t, e.target.checked)}
                        />
                        <span className="text-sm">{t.name}</span>
                        {existing && <span className="chip bg-accent-tint text-accent-hover">Added</span>}
                      </label>
                      {p && renderOptions(p)}
                    </li>
                  );
                })}
                {customs.map((p) => (
                  <li key={p.key}>
                    <div className="flex items-center gap-3 min-h-11">
                      <span className="h-5 w-5 shrink-0 rounded bg-accent text-white grid place-items-center text-xs" aria-hidden>
                        ✓
                      </span>
                      <span className="text-sm">{p.customName}</span>
                      <span className="chip">Other</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm ml-auto"
                        onClick={() => onChange(picked.filter((x) => x.key !== p.key))}
                        aria-label={`Remove ${p.customName}`}
                      >
                        Remove
                      </button>
                    </div>
                    {renderOptions(p)}
                  </li>
                ))}
              </ul>
              {!g.core && (
                <div className="mt-2">
                  <label htmlFor={`${uid}-other-${g.categoryId}`} className="label !text-caption !font-normal text-ink-soft">
                    Something else in {catName(g.categoryId)}? Add it under Other
                  </label>
                  <div className="flex gap-2">
                    <input
                      id={`${uid}-other-${g.categoryId}`}
                      className="field"
                      maxLength={120}
                      placeholder="e.g. Kolkali team"
                      value={otherDraft[g.categoryId] ?? ""}
                      aria-invalid={otherErr[g.categoryId] ? true : undefined}
                      aria-describedby={otherErr[g.categoryId] ? `${uid}-other-${g.categoryId}-err` : undefined}
                      onChange={(e) => setOtherDraft({ ...otherDraft, [g.categoryId]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addOther(g.categoryId);
                        }
                      }}
                    />
                    <button type="button" className="btn btn-secondary shrink-0" onClick={() => addOther(g.categoryId)}>
                      Add
                    </button>
                  </div>
                  {otherErr[g.categoryId] && (
                    <p id={`${uid}-other-${g.categoryId}-err`} className="hint !text-danger" role="alert">
                      {otherErr[g.categoryId]}
                    </p>
                  )}
                </div>
              )}
            </fieldset>
          </div>
        );
      })}
    </div>
  );
}

function Segmented({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <span className="text-caption text-ink-soft w-14 shrink-0" aria-hidden>
        {label}
      </span>
      <div className="inline-flex rounded-control border border-line-strong p-0.5">
        {options.map(([v, l]) => (
          <label
            key={v}
            className={`inline-flex items-center min-h-10 px-3 rounded-[6px] text-caption cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-focus)] ${
              value === v ? "bg-accent text-white" : "text-foreground"
            }`}
          >
            <input type="radio" className="sr-only" name={name} checked={value === v} onChange={() => onChange(v)} />
            {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
