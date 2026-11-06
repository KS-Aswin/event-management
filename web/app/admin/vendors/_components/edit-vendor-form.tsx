"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "./api";

// P1-11 edit on the vendor's behalf. Sends only the fields that changed
// (PATCH /api/admin/vendors/[id], same validation as the vendor's own
// profile form); the audit log records before and after.

export interface EditableVendor {
  name: string;
  vendorType: "company" | "individual";
  primaryCategoryId: number | null;
  districtId: number | null;
  location: string;
  about: string;
  phone: string;
  whatsapp: string;
  yearsExperience: string;
  yearEstablished: string;
  teamSize: string;
  languages: string;
  tags: string;
  addressLine: string;
  landmark: string;
  pincode: string;
  legalName: string;
  gstin: string;
  fssaiNo: string;
  instagramUrl: string;
  youtubeUrl: string;
  websiteUrl: string;
  travelOutsideKerala: boolean;
  maxEventsPerDay: string;
  maxGuests: string;
  adminNotes: string;
}

type Key = keyof EditableVendor;
type Option = { id: number; name: string };

const LIST_KEYS: Key[] = ["languages", "tags"];
const INT_KEYS: Key[] = ["yearsExperience", "yearEstablished", "teamSize", "maxEventsPerDay", "maxGuests"];

function toPayload(key: Key, v: EditableVendor[Key]): unknown {
  if (typeof v === "boolean") return v;
  if (key === "primaryCategoryId" || key === "districtId") return v ? Number(v) : null;
  const s = String(v ?? "").trim();
  if (LIST_KEYS.includes(key)) return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
  if (INT_KEYS.includes(key)) return s === "" ? null : Number(s);
  return s === "" ? null : s;
}

const LABELS: Record<Key, string> = {
  name: "Business name",
  vendorType: "Type",
  primaryCategoryId: "Main category",
  districtId: "Home district",
  location: "Town or area",
  about: "About",
  phone: "Phone",
  whatsapp: "WhatsApp",
  yearsExperience: "Years of experience",
  yearEstablished: "Year started",
  teamSize: "Team size",
  languages: "Languages",
  tags: "Specialities",
  addressLine: "Address",
  landmark: "Landmark",
  pincode: "PIN code",
  legalName: "Registered name",
  gstin: "GSTIN",
  fssaiNo: "FSSAI licence",
  instagramUrl: "Instagram",
  youtubeUrl: "YouTube",
  websiteUrl: "Website",
  travelOutsideKerala: "Travels outside Kerala",
  maxEventsPerDay: "Events per day",
  maxGuests: "Largest event (guests)",
  adminNotes: "Internal notes",
};

export default function EditVendorForm({
  vendorId,
  initial,
  districts,
  categories,
}: {
  vendorId: number;
  initial: EditableVendor;
  districts: Option[];
  categories: Option[];
}) {
  const router = useRouter();
  const uid = useId();
  const [values, setValues] = useState<EditableVendor>(initial);
  const [base, setBase] = useState<EditableVendor>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const changed = (Object.keys(values) as Key[]).filter((k) => String(values[k] ?? "") !== String(base[k] ?? ""));

  function set<K extends Key>(k: K, v: EditableVendor[K]) {
    setValues((s) => ({ ...s, [k]: v }));
    setDone(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!changed.length || busy) return;
    const body: Record<string, unknown> = {};
    for (const k of changed) body[k] = toPayload(k, values[k]);
    setBusy(true);
    setError(null);
    const r = await adminFetch(`/api/admin/vendors/${vendorId}`, "PATCH", body);
    setBusy(false);
    if (!r.ok) {
      setError({ text: r.error, field: r.field });
      if (r.field) document.getElementById(`${uid}-${r.field}`)?.focus();
      return;
    }
    setBase(values);
    setDone(r.data.changed ? `Saved: ${changed.map((k) => LABELS[k].toLowerCase()).join(", ")}. The change is in the audit log.` : "Nothing changed.");
    router.refresh();
  }

  const id = (k: Key) => `${uid}-${k}`;
  const errFor = (k: Key) => (error?.field === k ? error.text : null);
  const field = (k: Key, opts: { type?: string; inputMode?: "numeric" | "tel" | "url"; hint?: string; full?: boolean } = {}) => (
    <div className={opts.full ? "sm:col-span-2" : undefined}>
      <label htmlFor={id(k)} className="label">
        {LABELS[k]}
      </label>
      <input
        id={id(k)}
        type={opts.type ?? "text"}
        inputMode={opts.inputMode}
        className="field"
        value={String(values[k] ?? "")}
        onChange={(e) => set(k, e.target.value as never)}
        aria-invalid={errFor(k) ? true : undefined}
        aria-describedby={errFor(k) ? `${id(k)}-e` : opts.hint ? `${id(k)}-h` : undefined}
      />
      {errFor(k) ? (
        <p id={`${id(k)}-e`} className="hint text-danger">
          {errFor(k)}
        </p>
      ) : opts.hint ? (
        <p id={`${id(k)}-h`} className="hint">
          {opts.hint}
        </p>
      ) : null}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate data-testid="edit-vendor-form">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="eyebrow mb-2">Business</legend>
        {field("name", { full: true })}
        <div>
          <label htmlFor={id("vendorType")} className="label">
            {LABELS.vendorType}
          </label>
          <select id={id("vendorType")} className="field" value={values.vendorType} onChange={(e) => set("vendorType", e.target.value as EditableVendor["vendorType"])}>
            <option value="company">Company</option>
            <option value="individual">Individual</option>
          </select>
        </div>
        <div>
          <label htmlFor={id("primaryCategoryId")} className="label">
            {LABELS.primaryCategoryId}
          </label>
          <select
            id={id("primaryCategoryId")}
            className="field"
            value={values.primaryCategoryId ?? ""}
            onChange={(e) => set("primaryCategoryId", e.target.value ? Number(e.target.value) : null)}
            aria-invalid={errFor("primaryCategoryId") ? true : undefined}
          >
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={id("about")} className="label">
            {LABELS.about}
          </label>
          <textarea id={id("about")} className="field" rows={4} maxLength={2000} value={values.about} onChange={(e) => set("about", e.target.value)} aria-invalid={errFor("about") ? true : undefined} />
        </div>
        {field("yearsExperience", { inputMode: "numeric" })}
        {field("yearEstablished", { inputMode: "numeric" })}
        {field("teamSize", { inputMode: "numeric" })}
        {field("maxGuests", { inputMode: "numeric" })}
        {field("languages", { hint: "Separate with commas." })}
        {field("tags", { hint: "Separate with commas." })}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2 mt-6">
        <legend className="eyebrow mb-2">Contact and location</legend>
        {field("phone", { type: "tel", inputMode: "tel" })}
        {field("whatsapp", { type: "tel", inputMode: "tel" })}
        <div>
          <label htmlFor={id("districtId")} className="label">
            {LABELS.districtId}
          </label>
          <select
            id={id("districtId")}
            className="field"
            value={values.districtId ?? ""}
            onChange={(e) => set("districtId", e.target.value ? Number(e.target.value) : null)}
            aria-invalid={errFor("districtId") ? true : undefined}
          >
            <option value="">Choose…</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        {field("location")}
        {field("addressLine", { full: true })}
        {field("landmark")}
        {field("pincode", { inputMode: "numeric" })}
        {field("maxEventsPerDay", { inputMode: "numeric" })}
        <label className="flex items-center gap-3 min-h-11 text-body cursor-pointer sm:self-end">
          <input
            id={id("travelOutsideKerala")}
            type="checkbox"
            className="h-5 w-5 accent-[var(--color-accent)]"
            checked={values.travelOutsideKerala}
            onChange={(e) => set("travelOutsideKerala", e.target.checked)}
          />
          {LABELS.travelOutsideKerala}
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2 mt-6">
        <legend className="eyebrow mb-2">Registration and links</legend>
        {field("legalName")}
        {field("gstin")}
        {field("fssaiNo", { inputMode: "numeric" })}
        {field("websiteUrl", { type: "url", inputMode: "url" })}
        {field("instagramUrl", { type: "url", inputMode: "url" })}
        {field("youtubeUrl", { type: "url", inputMode: "url" })}
      </fieldset>

      <fieldset className="mt-6">
        <legend className="eyebrow mb-2">Admin only</legend>
        <label htmlFor={id("adminNotes")} className="label">
          {LABELS.adminNotes}
        </label>
        <textarea
          id={id("adminNotes")}
          className="field"
          rows={3}
          maxLength={2000}
          value={values.adminNotes}
          onChange={(e) => set("adminNotes", e.target.value)}
          aria-describedby={`${id("adminNotes")}-h`}
        />
        <p id={`${id("adminNotes")}-h`} className="hint">
          Never shown to the vendor or customers.
        </p>
      </fieldset>

      <div aria-live="polite" className="mt-4">
        {error && !error.field ? (
          <p role="alert" className="alert-error">
            {error.text}
          </p>
        ) : error?.field ? (
          <p role="alert" className="alert-error">
            {LABELS[error.field as Key] ?? "A field"}: {error.text}
          </p>
        ) : done ? (
          <p className="alert-success">{done}</p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
        {changed.length > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => { setValues(base); setError(null); }} disabled={busy}>
            Undo changes
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || changed.length === 0}>
          {busy ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}
        </button>
      </div>
    </form>
  );
}
