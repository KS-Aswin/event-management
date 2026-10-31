"use client";

import { useId, useState } from "react";
import { PRICE_MODE_LABELS, api, unitOptionLabel, type Offering, type PackageItem, type TaxonomyLite } from "./offering-api";

// Package composer: pick your own units, set quantities and notes, then the
// package price, guest range, inclusions and event types.

const PACKAGE_UNITS = ["package", "event", "day", "person", "plate"];

type Row = { serviceId: number; qty: string; note: string };

export default function OfferingPackageForm({
  tax,
  pkg,
  items = [],
  units,
  preselect = [],
  onSaved,
  onCancel,
}: {
  tax: TaxonomyLite;
  pkg?: Offering | null;
  items?: PackageItem[];
  /** The vendor's own units and add-ons to choose from. */
  units: Offering[];
  /** Unit ids ticked when starting a new package ("Create a package from these"). */
  preselect?: number[];
  onSaved: (pkg: Offering, items: PackageItem[]) => void;
  onCancel?: () => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState(pkg?.title ?? "");
  const [description, setDescription] = useState(pkg?.description ?? "");
  const [rows, setRows] = useState<Row[]>(
    pkg
      ? items.map((i) => ({ serviceId: i.item_id, qty: String(Number(i.qty)), note: i.note }))
      : preselect.map((id) => ({ serviceId: id, qty: "1", note: "" }))
  );
  const [priceMode, setPriceMode] = useState<Offering["price_mode"]>(pkg?.price_mode ?? "from");
  const [priceFrom, setPriceFrom] = useState(pkg && pkg.price_from > 0 ? String(pkg.price_from) : "");
  const [priceTo, setPriceTo] = useState(pkg?.price_to != null ? String(pkg.price_to) : "");
  const [priceUnit, setPriceUnit] = useState(pkg?.price_unit && PACKAGE_UNITS.includes(pkg.price_unit) ? pkg.price_unit : "package");
  const [guestMin, setGuestMin] = useState(pkg?.guest_min != null ? String(pkg.guest_min) : "");
  const [guestMax, setGuestMax] = useState(pkg?.guest_max != null ? String(pkg.guest_max) : "");
  const [inclusions, setInclusions] = useState((pkg?.inclusions ?? []).join("\n"));
  const [eventTypeIds, setEventTypeIds] = useState<number[]>(pkg?.event_type_ids ?? []);
  const [active, setActive] = useState(pkg ? pkg.active : true);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const choosable = units.filter((u) => u.kind !== "package");
  const toggle = (id: number, on: boolean) =>
    setRows((r) => (on ? [...r, { serviceId: id, qty: "1", note: "" }] : r.filter((x) => x.serviceId !== id)));
  const update = (id: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x) => (x.serviceId === id ? { ...x, ...patch } : x)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (title.trim().length < 2) return setErr({ field: "title", message: "Give the package a name, e.g. Hindu wedding basic." });
    if (!rows.length) return setErr({ field: "items", message: "Tick at least one of your offerings to include." });
    if (priceMode !== "on_request" && !(Number(priceFrom) > 0)) {
      return setErr({ field: "priceFrom", message: "Enter the package price, or choose On request." });
    }
    setSaving(true);
    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim(),
      priceMode,
      priceFrom: priceMode === "on_request" ? 0 : Number(priceFrom),
      priceTo: priceMode === "range" ? (priceTo === "" ? null : Number(priceTo)) : null,
      priceUnit,
      guestMin: guestMin === "" ? null : Number(guestMin),
      guestMax: guestMax === "" ? null : Number(guestMax),
      inclusions: inclusions.split("\n").map((s) => s.trim()).filter(Boolean),
      eventTypeIds,
      items: rows.map((r) => ({ serviceId: r.serviceId, qty: r.qty === "" ? 1 : Number(r.qty), note: r.note })),
    };
    if (pkg) body.active = active;
    const r = pkg
      ? await api<{ offering: Offering; items: PackageItem[] }>(`/api/vendor/packages/${pkg.id}`, "PATCH", body)
      : await api<{ offering: Offering; items: PackageItem[] }>("/api/vendor/packages", "POST", body);
    setSaving(false);
    if (!r.ok) return setErr({ field: r.field, message: r.error });
    onSaved(r.data.offering, r.data.items);
  }

  const fe = (f: string) => (err?.field === f ? err.message : undefined);
  const known = ["title", "items", "priceFrom", "priceTo", "guestMin", "guestMax"];

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={submit}>
      <div>
        <label htmlFor={`${uid}-t`} className="label">
          Package name
        </label>
        <input
          id={`${uid}-t`}
          className="field"
          maxLength={120}
          value={title}
          placeholder="e.g. Hindu wedding basic"
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={fe("title") ? true : undefined}
          aria-describedby={fe("title") ? `${uid}-t-err` : undefined}
        />
        {fe("title") && (
          <p id={`${uid}-t-err`} className="hint !text-danger" role="alert">
            {fe("title")}
          </p>
        )}
      </div>

      <fieldset aria-describedby={fe("items") ? `${uid}-i-err` : undefined}>
        <legend className="label">What&apos;s in the package</legend>
        {choosable.length === 0 ? (
          <p className="text-body text-ink-soft">Add a few offerings first, then bundle them here.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border border-line rounded-card">
            {choosable.map((u) => {
              const row = rows.find((r) => r.serviceId === u.id);
              return (
                <li key={u.id} className="p-3">
                  <label className="flex items-start gap-3 min-h-11 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                      checked={!!row}
                      onChange={(e) => toggle(u.id, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{u.title}</span>
                      <span className="block text-caption text-ink-soft">
                        {u.category} · {u.sale_mode === "package_only" ? "Package only" : u.price_label}
                        {!u.active ? " · off (the package will be marked incomplete)" : ""}
                      </span>
                    </span>
                  </label>
                  {row && (
                    <div className="mt-2 ml-8 grid gap-3 grid-cols-[96px_1fr]">
                      <div>
                        <label htmlFor={`${uid}-q-${u.id}`} className="label !text-caption">
                          Qty
                        </label>
                        <input
                          id={`${uid}-q-${u.id}`}
                          className="field"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={row.qty}
                          onChange={(e) => update(u.id, { qty: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`${uid}-n-${u.id}`} className="label !text-caption">
                          Note <span className="text-ink-soft font-normal">(optional)</span>
                        </label>
                        <input
                          id={`${uid}-n-${u.id}`}
                          className="field"
                          maxLength={200}
                          value={row.note}
                          placeholder="e.g. 300 plates, 4 hours"
                          onChange={(e) => update(u.id, { note: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {fe("items") && (
          <p id={`${uid}-i-err`} className="hint !text-danger" role="alert">
            {fe("items")}
          </p>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="label sm:col-span-2">Package price</legend>
        <div>
          <label htmlFor={`${uid}-pm`} className="label">
            Price type
          </label>
          <select id={`${uid}-pm`} className="field" value={priceMode} onChange={(e) => setPriceMode(e.target.value as Offering["price_mode"])}>
            {(Object.keys(PRICE_MODE_LABELS) as Offering["price_mode"][]).map((m) => (
              <option key={m} value={m}>
                {PRICE_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-pu`} className="label">
            Charged
          </label>
          <select id={`${uid}-pu`} className="field" value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)}>
            {PACKAGE_UNITS.map((u) => (
              <option key={u} value={u}>
                {unitOptionLabel(tax, u)}
              </option>
            ))}
          </select>
        </div>
        {priceMode !== "on_request" && (
          <div>
            <label htmlFor={`${uid}-pf`} className="label">
              {priceMode === "range" ? "From (₹)" : "Price (₹)"}
            </label>
            <input
              id={`${uid}-pf`}
              className="field"
              type="number"
              inputMode="numeric"
              min={1}
              value={priceFrom}
              onChange={(e) => setPriceFrom(e.target.value)}
              aria-invalid={fe("priceFrom") ? true : undefined}
              aria-describedby={fe("priceFrom") ? `${uid}-pf-err` : undefined}
            />
            {fe("priceFrom") && (
              <p id={`${uid}-pf-err`} className="hint !text-danger" role="alert">
                {fe("priceFrom")}
              </p>
            )}
          </div>
        )}
        {priceMode === "range" && (
          <div>
            <label htmlFor={`${uid}-pt`} className="label">
              Up to (₹)
            </label>
            <input
              id={`${uid}-pt`}
              className="field"
              type="number"
              inputMode="numeric"
              min={1}
              value={priceTo}
              onChange={(e) => setPriceTo(e.target.value)}
              aria-invalid={fe("priceTo") ? true : undefined}
              aria-describedby={fe("priceTo") ? `${uid}-pt-err` : undefined}
            />
            {fe("priceTo") && (
              <p id={`${uid}-pt-err`} className="hint !text-danger" role="alert">
                {fe("priceTo")}
              </p>
            )}
          </div>
        )}
        <div>
          <label htmlFor={`${uid}-gmin`} className="label">
            Guests from <span className="text-ink-soft font-normal">(optional)</span>
          </label>
          <input id={`${uid}-gmin`} className="field" type="number" inputMode="numeric" min={1} value={guestMin} onChange={(e) => setGuestMin(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-gmax`} className="label">
            Guests up to <span className="text-ink-soft font-normal">(optional)</span>
          </label>
          <input
            id={`${uid}-gmax`}
            className="field"
            type="number"
            inputMode="numeric"
            min={1}
            value={guestMax}
            onChange={(e) => setGuestMax(e.target.value)}
            aria-invalid={fe("guestMax") ? true : undefined}
          />
          {fe("guestMax") && <p className="hint !text-danger" role="alert">{fe("guestMax")}</p>}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${uid}-d`} className="label">
          Description <span className="text-ink-soft font-normal">(optional)</span>
        </label>
        <textarea id={`${uid}-d`} className="field" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${uid}-inc`} className="label">
          Also included <span className="text-ink-soft font-normal">(one per line, optional)</span>
        </label>
        <textarea
          id={`${uid}-inc`}
          className="field"
          rows={3}
          value={inclusions}
          placeholder={"Welcome drink\nTransport for the team"}
          onChange={(e) => setInclusions(e.target.value)}
        />
      </div>

      {tax.eventTypes.length > 0 && (
        <fieldset>
          <legend className="label">
            Good for <span className="text-ink-soft font-normal">(optional)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {tax.eventTypes.map((et) => {
              const on = eventTypeIds.includes(et.id);
              return (
                <label
                  key={et.id}
                  className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-control border text-sm cursor-pointer ${
                    on ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    checked={on}
                    onChange={(e) => setEventTypeIds(e.target.checked ? [...eventTypeIds, et.id] : eventTypeIds.filter((x) => x !== et.id))}
                  />
                  {et.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {pkg && (
        <label className="flex items-center gap-3 min-h-11 cursor-pointer text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[var(--color-accent)]" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="font-medium">Show this package on my profile</span>
        </label>
      )}

      {err && !known.includes(err.field ?? "") && (
        <p className="alert-error" role="alert">
          {err.message}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : pkg ? "Save package" : "Create package"}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
