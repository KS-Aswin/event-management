"use client";

import { useCallback, useRef, useState } from "react";
import OfferingUnitForm, { type UnitFormHandle } from "@/app/vendor/_components/offering-unit-form";
import OfferingPackageForm from "@/app/vendor/_components/offering-package-form";
import { Chip, api, offeringChips, type Offering, type PackageItem } from "@/app/vendor/_components/offering-api";
import { StepActions } from "./step-actions";
import type { StepProps } from "./types";

export default function StepPrices({ tax, data, setData, next, back }: StepProps) {
  const units = data.offerings.filter((o) => o.kind !== "package");
  const packages = data.offerings.filter((o) => o.kind === "package");
  const handles = useRef(new Map<number, UnitFormHandle>());
  const [open, setOpen] = useState<Set<number>>(() => new Set(units.filter((u) => u.needs_price).map((u) => u.id)));
  const [composer, setComposer] = useState<null | { pkg: Offering | null }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const registerFor = useCallback(
    (id: number) => (h: UnitFormHandle | null) => {
      if (h) handles.current.set(id, h);
      else handles.current.delete(id);
    },
    []
  );
  const replace = useCallback(
    (o: Offering) => setData((d) => ({ ...d, offerings: d.offerings.map((x) => (x.id === o.id ? o : x)) })),
    [setData]
  );

  async function remove(o: Offering) {
    if (!window.confirm(`Remove “${o.title}”?`)) return;
    setRemoving(o.id);
    const r = await api(`/api/vendor/offerings/${o.id}`, "DELETE");
    setRemoving(null);
    if (!r.ok) return setError(r.error);
    const fresh = await api<{ offerings: Offering[]; packageItems: PackageItem[] }>("/api/vendor/offerings");
    setData((d) =>
      fresh.ok
        ? { ...d, offerings: fresh.data.offerings, packageItems: fresh.data.packageItems }
        : { ...d, offerings: d.offerings.filter((x) => x.id !== o.id) }
    );
  }

  async function onContinue() {
    setError(null);
    setBusy(true);
    for (const u of units) {
      const h = handles.current.get(u.id);
      if (!h || !(h.dirty() || u.needs_price)) continue;
      const ok = await h.save();
      if (!ok) {
        setBusy(false);
        setOpen((s) => new Set(s).add(u.id));
        setError(`Check “${u.title}”: it needs a price before you continue (or remove it).`);
        document.getElementById(`unit-${u.id}`)?.scrollIntoView({ block: "start" });
        return;
      }
    }
    setBusy(false);
    // Submit needs something bookable on its own (the server re-checks on submit).
    const bookable = units.some((u) => u.sale_mode === "separate") || packages.some((p) => p.active && !p.incomplete);
    if (!bookable) {
      setError("Customers need at least one offering they can book on its own: make one Bookable separately, or create a package.");
      return;
    }
    await next();
  }

  const packageOnly = units.filter((u) => u.sale_mode === "package_only");

  return (
    <div className="flex flex-col gap-6">
      <p className="text-lead text-ink-soft -mt-3">
        Give each offering a starting price. Customers see “Starting from ₹…”, and you send the exact quote later.
      </p>

      {units.length === 0 ? (
        <div className="card text-center">
          <p className="text-body">You haven&apos;t added any offerings yet.</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={back}>
            Go back and pick what you offer
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {units.map((u) => {
            const isOpen = open.has(u.id);
            return (
              <li key={u.id} id={`unit-${u.id}`} className="card !p-0 scroll-mt-24">
                <div className="flex items-start gap-3 p-4">
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left min-h-11"
                    aria-expanded={isOpen}
                    aria-controls={`unit-${u.id}-form`}
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s);
                        if (n.has(u.id)) n.delete(u.id);
                        else n.add(u.id);
                        return n;
                      })
                    }
                  >
                    <span className="block font-medium truncate">{u.title}</span>
                    <span className="block text-caption text-ink-soft">
                      {u.category} · {u.needs_price ? "No price yet" : u.price_label}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {offeringChips(u)
                        .filter((c) => c.label !== "Off")
                        .map((c) => (
                          <Chip key={c.label} {...c} />
                        ))}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm shrink-0"
                    onClick={() => void remove(u)}
                    disabled={removing === u.id}
                    aria-label={`Remove ${u.title}`}
                  >
                    {removing === u.id ? "Removing…" : "Remove"}
                  </button>
                </div>
                <div id={`unit-${u.id}-form`} hidden={!isOpen} className="px-4 pb-4 border-t border-line pt-4">
                  <OfferingUnitForm
                    tax={tax}
                    offering={u}
                    variant="compact"
                    allOfferings={data.offerings}
                    activateOnSave
                    onSaved={replace}
                    register={registerFor(u.id)}
                    submitLabel="Save this offering"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="pk-h" className="pt-2">
        <h2 id="pk-h" className="text-title font-semibold">
          Packages <span className="text-ink-soft font-normal text-body">(optional)</span>
        </h2>
        <p className="text-body text-ink-soft mt-1">
          Bundle units into one price, e.g. “Hindu wedding basic: sadhya for 300, mandapam décor, photography”.
        </p>
        {packageOnly.length > 0 && packages.length === 0 && (
          <p className="mt-3 rounded-control bg-[#fdf3d8] text-gold-ink px-3 py-2 text-sm">
            {packageOnly.length === 1 ? "One unit is" : `${packageOnly.length} units are`} set to Package only. Customers
            only see {packageOnly.length === 1 ? "it" : "them"} inside a package, so create one below.
          </p>
        )}
        {packages.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {packages.map((p) => (
              <li key={p.id} className="card flex items-center gap-3 !py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{p.title}</p>
                  <p className="text-caption text-ink-soft">
                    {p.price_label} · {(() => { const n = data.packageItems.filter((i) => i.package_id === p.id).length; return `${n} item${n === 1 ? "" : "s"}`; })()}
                    {p.incomplete ? " · incomplete: an included unit is off" : ""}
                  </p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setComposer({ pkg: p })}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
        {composer ? (
          <div className="card mt-4">
            <h3 className="text-title font-semibold mb-4">{composer.pkg ? "Edit package" : "New package"}</h3>
            <OfferingPackageForm
              key={composer.pkg?.id ?? "new"}
              tax={tax}
              pkg={composer.pkg}
              items={composer.pkg ? data.packageItems.filter((i) => i.package_id === composer.pkg!.id) : []}
              units={units}
              preselect={packageOnly.map((u) => u.id)}
              onCancel={() => setComposer(null)}
              onSaved={(pkg, items) => {
                setData((d) => ({
                  ...d,
                  offerings: d.offerings.some((o) => o.id === pkg.id)
                    ? d.offerings.map((o) => (o.id === pkg.id ? pkg : o))
                    : [...d.offerings, pkg],
                  packageItems: [...d.packageItems.filter((i) => i.package_id !== pkg.id), ...items],
                }));
                setComposer(null);
              }}
            />
          </div>
        ) : (
          units.length > 0 && (
            <button type="button" className="btn btn-secondary mt-4" onClick={() => setComposer({ pkg: null })}>
              Create a package from these
            </button>
          )
        )}
      </section>

      <StepActions onBack={back} onContinue={() => void onContinue()} busy={busy} error={error} />
    </div>
  );
}
