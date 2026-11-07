"use client";

import { useState } from "react";
import OfferingUnitPicker, { type PickedUnit } from "@/app/vendor/_components/offering-unit-picker";
import { api, type Offering } from "@/app/vendor/_components/offering-api";
import { StepActions } from "./step-actions";
import type { StepProps } from "./types";

const MAX_EXTRA = 5;

export default function StepOffer({ tax, data, setData, saveListing, next, back }: StepProps) {
  const primaryId = data.listing?.primaryCategoryId ?? null;
  const primary = tax.categories.find((c) => c.id === primaryId);
  const eventCompany = primary?.slug === "event-management";
  const [extra, setExtra] = useState<number[]>(data.additionalCategoryIds.filter((id) => id !== primaryId));
  const [picked, setPicked] = useState<PickedUnit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);

  const units = data.offerings.filter((o) => o.kind !== "package");
  const existingTemplateIds = units.map((o) => o.template_id).filter((x): x is number => !!x);
  const existingCustom = units.filter((o) => !o.template_id);
  const categoryIds = primaryId ? [primaryId, ...extra] : extra;

  async function onContinue() {
    setError(null);
    if (!units.length && !picked.length) {
      setError("Tick at least one thing you offer, or add one under Other.");
      return;
    }
    setBusy(true);
    const saved = await saveListing({ additionalCategoryIds: extra });
    if (!saved.ok) {
      setBusy(false);
      setError(saved.error);
      return;
    }
    const created: Offering[] = [];
    const failed: PickedUnit[] = [];
    let firstError = "";
    let anyFlagged = false;
    for (const p of picked) {
      const r = await api<{ offering: Offering; flaggedContact: boolean }>("/api/vendor/offerings", "POST", {
        draft: true,
        kind: "unit",
        templateId: p.templateId,
        categoryId: p.categoryId,
        customName: p.customName,
        saleMode: p.saleMode,
        fulfilment: p.fulfilment,
      });
      if (r.ok) {
        created.push(r.data.offering);
        if (r.data.flaggedContact) anyFlagged = true;
      } else {
        failed.push(p);
        firstError ||= r.error;
      }
    }
    if (created.length) setData((d) => ({ ...d, offerings: [...d.offerings, ...created] }));
    setPicked(failed);
    setBusy(false);
    if (failed.length) {
      setError(`${failed.length} offering${failed.length > 1 ? "s" : ""} couldn't be saved: ${firstError}`);
      return;
    }
    if (anyFlagged) {
      // Show the masking note once before moving on.
      setFlagged(true);
      return;
    }
    await next();
  }

  if (flagged) {
    return (
      <div className="flex flex-col gap-4">
        <p className="alert-success" role="status">
          Saved. We hid a phone number or link you typed into an offering name: customers contact you through Vela, so
          contact details aren&apos;t allowed in names.
        </p>
        <StepActions onBack={back} onContinue={() => void next()} continueLabel="Continue" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-lead text-ink-soft -mt-3">
        {eventCompany
          ? "Tick everything your company can provide. You'll set prices in the next step, and can bundle units into packages."
          : "Tick the services you offer. You'll set prices in the next step."}
      </p>

      <fieldset>
        <legend className="text-title font-semibold">Your categories</legend>
        <p className="text-body text-ink-soft mt-1 mb-3">
          Main: <strong className="text-foreground">{primary?.display_name ?? primary?.name ?? "not set"}</strong>. Add
          others you also work in (up to {MAX_EXTRA}).
        </p>
        <div className="flex flex-wrap gap-2">
          {tax.categories
            .filter((c) => c.id !== primaryId)
            .map((c) => {
              const on = extra.includes(c.id);
              const full = !on && extra.length >= MAX_EXTRA;
              return (
                <label
                  key={c.id}
                  className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-control border text-sm ${
                    full ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                  } ${on ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong"}`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    checked={on}
                    disabled={full}
                    onChange={(e) => setExtra(e.target.checked ? [...extra, c.id] : extra.filter((x) => x !== c.id))}
                  />
                  {c.display_name || c.name}
                </label>
              );
            })}
        </div>
      </fieldset>

      <section aria-labelledby="units-h">
        <h2 id="units-h" className="text-title font-semibold mb-3">
          What you offer
        </h2>
        {existingCustom.length > 0 && (
          <p className="text-body text-ink-soft mb-4">
            Already added: {existingCustom.map((o) => o.title).join(", ")}.
          </p>
        )}
        <OfferingUnitPicker
          tax={tax}
          categoryIds={categoryIds}
          eventCompany={eventCompany}
          existingTemplateIds={existingTemplateIds}
          picked={picked}
          onChange={setPicked}
        />
      </section>

      <StepActions onBack={back} onContinue={() => void onContinue()} busy={busy} error={error} />
    </div>
  );
}
