"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import OfferingAttributeFields from "./offering-attribute-fields";
import {
  PRICE_MODE_LABELS,
  api,
  categoryName,
  rulesFor,
  unitOptionLabel,
  type Offering,
  type TaxonomyLite,
} from "./offering-api";

// Editor for one unit or add-on: name, description, sale mode, fulfilment,
// price (mode / amount / unit / min qty) and the template's attributes.
// "compact" (wizard step 3) shows the essentials and the first few details;
// "full" (/vendor/offerings) shows everything.

export interface NewOfferingSpec {
  templateId: number | null;
  categoryId: number;
  customName?: string;
  kind: "unit" | "addon";
}

export interface UnitFormHandle {
  save: () => Promise<boolean>;
  dirty: () => boolean;
}

type ErrState = { field?: string; message: string } | null;

function str(v: unknown) {
  return v === null || v === undefined ? "" : String(v);
}

export default function OfferingUnitForm({
  tax,
  offering,
  spec,
  variant,
  allOfferings = [],
  activateOnSave = false,
  onSaved,
  onCancel,
  register,
  submitLabel = "Save",
  hideSubmit = false,
}: {
  tax: TaxonomyLite;
  offering?: Offering | null;
  spec?: NewOfferingSpec;
  variant: "compact" | "full";
  allOfferings?: Offering[];
  /** Turn the offering on when saved (wizard: a priced unit goes live). */
  activateOnSave?: boolean;
  onSaved: (o: Offering) => void;
  onCancel?: () => void;
  register?: (h: UnitFormHandle | null) => void;
  submitLabel?: string;
  hideSubmit?: boolean;
}) {
  const uid = useId();
  const isNew = !offering;
  const kind = offering?.kind ?? spec?.kind ?? "unit";
  const templateId = offering ? offering.template_id : spec?.templateId ?? null;
  const categoryId = offering?.category_id ?? spec?.categoryId ?? 0;
  const rules = rulesFor(tax, { template_id: templateId, category_id: categoryId, kind });
  const template = templateId ? tax.templates.find((t) => t.id === templateId) : undefined;
  const isCustom = !templateId;

  const [title, setTitle] = useState(offering?.title ?? spec?.customName ?? template?.name ?? "");
  const [description, setDescription] = useState(offering?.description ?? "");
  const [saleMode, setSaleMode] = useState<Offering["sale_mode"]>(offering?.sale_mode ?? "separate");
  const [fulfilment, setFulfilment] = useState<Offering["fulfilment"]>(offering?.fulfilment ?? "in_house");
  const [parentId, setParentId] = useState(str(offering?.parent_service_id));
  const [priceMode, setPriceMode] = useState<Offering["price_mode"]>(offering?.price_mode ?? "from");
  const [priceFrom, setPriceFrom] = useState(offering && offering.price_from > 0 ? String(offering.price_from) : "");
  const [priceTo, setPriceTo] = useState(str(offering?.price_to));
  const [priceUnit, setPriceUnit] = useState(
    offering && rules.allowedPriceUnits.includes(offering.price_unit) ? offering.price_unit : rules.defaultPriceUnit
  );
  const [unitLabel, setUnitLabel] = useState(offering?.unit_label ?? "");
  const [minQty, setMinQty] = useState(offering?.min_qty ? String(Number(offering.min_qty)) : "");
  const [maxQty, setMaxQty] = useState(offering?.max_qty ? String(Number(offering.max_qty)) : "");
  const [guestMax, setGuestMax] = useState(str(offering?.guest_max));
  const [leadTime, setLeadTime] = useState(str(offering?.lead_time_days));
  const [inclusions, setInclusions] = useState((offering?.inclusions ?? []).join("\n"));
  const [eventTypeIds, setEventTypeIds] = useState<number[]>(offering?.event_type_ids ?? []);
  const [attributes, setAttributes] = useState<Record<string, unknown>>(offering?.attributes ?? {});
  const [active, setActive] = useState(offering ? offering.active || offering.needs_price : true);
  const [err, setErr] = useState<ErrState>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const dirtyRef = useRef(isNew);
  const touch = <T,>(fn: (v: T) => void) => (v: T) => {
    dirtyRef.current = true;
    setSavedMsg("");
    fn(v);
  };

  const parents = allOfferings.filter((o) => o.kind !== "addon" && o.id !== offering?.id);
  const schema = variant === "compact" ? rules.schema.filter((f) => f.type !== "tags").slice(0, 3) : rules.schema;

  const save = useCallback(async (): Promise<boolean> => {
    setErr(null);
    if (priceMode !== "on_request" && !(Number(priceFrom) > 0)) {
      setErr({ field: "priceFrom", message: "Enter a price above ₹0." });
      return false;
    }
    setSaving(true);
    const body: Record<string, unknown> = {
      title: title.trim() || undefined,
      description: description.trim(),
      fulfilment,
      priceMode,
      priceFrom: priceMode === "on_request" ? (priceFrom ? Number(priceFrom) : 0) : Number(priceFrom),
      priceUnit,
      minQty: minQty === "" ? null : Number(minQty),
      attributes,
    };
    if (kind === "unit") body.saleMode = saleMode;
    if (kind === "addon") body.parentServiceId = parentId ? Number(parentId) : null;
    if (priceMode === "range") body.priceTo = priceTo === "" ? null : Number(priceTo);
    if (variant === "full") {
      body.unitLabel = unitLabel.trim() || null;
      body.maxQty = maxQty === "" ? null : Number(maxQty);
      body.guestMax = guestMax === "" ? null : Number(guestMax);
      body.leadTimeDays = leadTime === "" ? null : Number(leadTime);
      body.inclusions = inclusions.split("\n").map((s) => s.trim()).filter(Boolean);
      body.eventTypeIds = eventTypeIds;
      body.active = active;
    } else if (activateOnSave) {
      body.active = true;
    }
    if (isCustom) body.customName = title.trim();

    const r = offering
      ? await api<{ offering: Offering }>(`/api/vendor/offerings/${offering.id}`, "PATCH", body)
      : await api<{ offering: Offering }>("/api/vendor/offerings", "POST", {
          ...body,
          kind,
          templateId,
          categoryId,
        });
    setSaving(false);
    if (!r.ok) {
      setErr({ field: r.field, message: r.error });
      return false;
    }
    dirtyRef.current = false;
    setSavedMsg("Saved");
    onSaved(r.data.offering);
    return true;
  }, [
    active, activateOnSave, attributes, categoryId, description, eventTypeIds, fulfilment, guestMax, inclusions,
    isCustom, kind, leadTime, maxQty, minQty, offering, onSaved, parentId, priceFrom, priceMode, priceTo, priceUnit,
    saleMode, templateId, title, unitLabel, variant,
  ]);

  useEffect(() => {
    register?.({ save, dirty: () => dirtyRef.current });
    return () => register?.(null);
  }, [register, save]);

  const fieldErr = (f: string) => (err?.field === f ? err.message : undefined);
  const errProps = (f: string) =>
    fieldErr(f) ? { "aria-invalid": true as const, "aria-describedby": `${uid}-${f}-err` } : {};
  const errText = (f: string) =>
    fieldErr(f) ? (
      <p id={`${uid}-${f}-err`} className="hint !text-danger" role="alert">
        {fieldErr(f)}
      </p>
    ) : null;
  const generalErr = err && !["title", "customName", "priceFrom", "priceTo", "priceUnit", "minQty", "maxQty", "parentServiceId", "guestMax", "leadTimeDays"].includes(err.field ?? "") && !err.field?.startsWith("attributes.");

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-title`} className="label">
            {isCustom ? "Name of your offering" : "Name shown to customers"}
          </label>
          <input
            id={`${uid}-title`}
            className="field"
            value={title}
            maxLength={120}
            onChange={(e) => touch(setTitle)(e.target.value)}
            {...errProps(fieldErr("title") ? "title" : "customName")}
          />
          {!isCustom && template ? (
            <p className="hint">
              Standard offering: {template.name} · {categoryName(tax, categoryId)}
            </p>
          ) : (
            <p className="hint">Custom offering in {categoryName(tax, categoryId)}. Our team reviews new names.</p>
          )}
          {errText("title")}
          {errText("customName")}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-desc`} className="label">
            Description <span className="text-ink-soft font-normal">(optional)</span>
          </label>
          <textarea
            id={`${uid}-desc`}
            className="field"
            rows={variant === "compact" ? 2 : 4}
            maxLength={2000}
            value={description}
            placeholder="What's included, how long, what makes it yours."
            onChange={(e) => touch(setDescription)(e.target.value)}
          />
          <p className="hint">Phone numbers and links are hidden from customers. They contact you through Vela.</p>
        </div>
      </div>

      {kind === "unit" && (
        <fieldset>
          <legend className="label">How customers can book it</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["separate", "Bookable separately", "Shows in search and can be enquired on its own."],
                ["package_only", "Package only", "Only offered inside your packages."],
              ] as const
            ).map(([v, l, h]) => (
              <label
                key={v}
                className={`flex gap-3 p-3 rounded-control border cursor-pointer ${
                  saleMode === v ? "border-accent bg-accent-tint" : "border-line-strong"
                }`}
              >
                <input
                  type="radio"
                  name={`${uid}-sale`}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                  checked={saleMode === v}
                  onChange={() => touch(setSaleMode)(v)}
                />
                <span>
                  <span className="block text-sm font-medium">{l}</span>
                  <span className="block text-caption text-ink-soft">{h}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {kind === "addon" && (
        <div>
          <label htmlFor={`${uid}-parent`} className="label">
            Add-on to
          </label>
          <select
            id={`${uid}-parent`}
            className="field"
            value={parentId}
            onChange={(e) => touch(setParentId)(e.target.value)}
            {...errProps("parentServiceId")}
          >
            <option value="">Choose an offering</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          {errText("parentServiceId")}
        </div>
      )}

      <fieldset>
        <legend className="label">Who does the work</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["in_house", "Our own team"],
              ["partner", "A partner we work with"],
            ] as const
          ).map(([v, l]) => (
            <label
              key={v}
              className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-control border text-sm cursor-pointer ${
                fulfilment === v ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong"
              }`}
            >
              <input
                type="radio"
                name={`${uid}-ful`}
                className="h-4 w-4 accent-[var(--color-accent)]"
                checked={fulfilment === v}
                onChange={() => touch(setFulfilment)(v)}
              />
              {l}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="label sm:col-span-2">Price</legend>
        <div>
          <label htmlFor={`${uid}-pmode`} className="label">
            Price type
          </label>
          <select
            id={`${uid}-pmode`}
            className="field"
            value={priceMode}
            onChange={(e) => touch(setPriceMode)(e.target.value as Offering["price_mode"])}
          >
            {(Object.keys(PRICE_MODE_LABELS) as Offering["price_mode"][])
              .filter((m) => m !== "on_request" || rules.allowOnRequest)
              .map((m) => (
                <option key={m} value={m}>
                  {PRICE_MODE_LABELS[m]}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-unit`} className="label">
            Charged
          </label>
          <select
            id={`${uid}-unit`}
            className="field"
            value={priceUnit}
            onChange={(e) => touch(setPriceUnit)(e.target.value)}
            {...errProps("priceUnit")}
          >
            {rules.allowedPriceUnits.map((u) => (
              <option key={u} value={u}>
                {unitOptionLabel(tax, u)}
              </option>
            ))}
          </select>
          {errText("priceUnit")}
        </div>
        {priceMode !== "on_request" && (
          <div>
            <label htmlFor={`${uid}-from`} className="label">
              {priceMode === "range" ? "From (₹)" : priceMode === "fixed" ? "Price (₹)" : "Starting price (₹)"}
            </label>
            <input
              id={`${uid}-from`}
              className="field"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={priceFrom}
              placeholder="e.g. 45000"
              onChange={(e) => touch(setPriceFrom)(e.target.value)}
              {...errProps("priceFrom")}
            />
            {errText("priceFrom")}
          </div>
        )}
        {priceMode === "range" && (
          <div>
            <label htmlFor={`${uid}-to`} className="label">
              Up to (₹)
            </label>
            <input
              id={`${uid}-to`}
              className="field"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={priceTo}
              onChange={(e) => touch(setPriceTo)(e.target.value)}
              {...errProps("priceTo")}
            />
            {errText("priceTo")}
          </div>
        )}
        <div>
          <label htmlFor={`${uid}-minq`} className="label">
            Minimum order <span className="text-ink-soft font-normal">(optional)</span>
          </label>
          <input
            id={`${uid}-minq`}
            className="field"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={minQty}
            placeholder={priceUnit === "plate" ? "e.g. 100" : ""}
            onChange={(e) => touch(setMinQty)(e.target.value)}
            {...errProps("minQty")}
          />
          <p className="hint">In {unitOptionLabel(tax, priceUnit).replace(/^Per /, "").toLowerCase()}s.</p>
          {errText("minQty")}
        </div>
        {variant === "full" && (
          <>
            <div>
              <label htmlFor={`${uid}-maxq`} className="label">
                Maximum order <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input
                id={`${uid}-maxq`}
                className="field"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={maxQty}
                onChange={(e) => touch(setMaxQty)(e.target.value)}
                {...errProps("maxQty")}
              />
              {errText("maxQty")}
            </div>
            <div>
              <label htmlFor={`${uid}-ulabel`} className="label">
                Unit name <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input
                id={`${uid}-ulabel`}
                className="field"
                maxLength={30}
                value={unitLabel}
                placeholder={priceUnit === "plate" ? "e.g. leaf" : ""}
                onChange={(e) => touch(setUnitLabel)(e.target.value)}
              />
              <p className="hint">Shown as “per {unitLabel.trim() || unitOptionLabel(tax, priceUnit).replace(/^Per /i, "").toLowerCase()}”.</p>
            </div>
          </>
        )}
      </fieldset>

      {variant === "full" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-gmax`} className="label">
              Largest event you can serve (guests)
            </label>
            <input
              id={`${uid}-gmax`}
              className="field"
              type="number"
              inputMode="numeric"
              min={1}
              value={guestMax}
              onChange={(e) => touch(setGuestMax)(e.target.value)}
              {...errProps("guestMax")}
            />
            {errText("guestMax")}
          </div>
          <div>
            <label htmlFor={`${uid}-lead`} className="label">
              Book at least (days ahead)
            </label>
            <input
              id={`${uid}-lead`}
              className="field"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              value={leadTime}
              onChange={(e) => touch(setLeadTime)(e.target.value)}
              {...errProps("leadTimeDays")}
            />
            {errText("leadTimeDays")}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-incl`} className="label">
              What&apos;s included <span className="text-ink-soft font-normal">(one per line)</span>
            </label>
            <textarea
              id={`${uid}-incl`}
              className="field"
              rows={3}
              value={inclusions}
              onChange={(e) => touch(setInclusions)(e.target.value)}
            />
          </div>
          {tax.eventTypes.length > 0 && (
            <fieldset className="sm:col-span-2">
              <legend className="label">Good for these events <span className="text-ink-soft font-normal">(optional)</span></legend>
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
                        onChange={(e) =>
                          touch(setEventTypeIds)(e.target.checked ? [...eventTypeIds, et.id] : eventTypeIds.filter((x) => x !== et.id))
                        }
                      />
                      {et.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      )}

      {schema.length > 0 && (
        <fieldset>
          <legend className="label">{variant === "compact" ? "Key details (optional)" : "Details"}</legend>
          <OfferingAttributeFields
            schema={schema}
            values={attributes}
            onChange={touch(setAttributes)}
            errorKey={err?.field}
            error={err?.message}
          />
        </fieldset>
      )}

      {variant === "full" && (
        <label className="flex items-center gap-3 min-h-11 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--color-accent)]"
            checked={active}
            onChange={(e) => touch(setActive)(e.target.checked)}
          />
          <span>
            <span className="font-medium">Show on my profile</span>
            <span className="block text-caption text-ink-soft">
              Turning a unit off marks packages that include it as incomplete and hides them.
            </span>
          </span>
        </label>
      )}

      {generalErr && (
        <p className="alert-error" role="alert">
          {err!.message}
        </p>
      )}

      {!hideSubmit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : submitLabel}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <span className="text-caption text-ink-soft" role="status" aria-live="polite">
            {savedMsg}
          </span>
        </div>
      )}
    </form>
  );
}
