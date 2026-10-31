"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface InitialValues {
  vendorId: number;
  name: string;
  category: string;
  location: string;
  districtId: number | null;
  phone: string | null;
  whatsapp: string | null;
  price: number;
  experience: string;
  tags: string[];
  about: string;
}

type FieldKey = "name" | "category" | "location" | "phone" | "whatsapp" | "price" | "experience" | "about";

// Shared .field, with a darker edge so inputs meet the 3:1 non-text contrast minimum.
const inputClass = "field border-[#80868b] focus:border-accent aria-[invalid=true]:border-danger";

const PHONE_RE = /^\+?[\d\s-]{10,15}$/;

export default function ListingForm({
  mode,
  initialValues,
  categories,
  districts,
}: {
  mode: "create" | "edit";
  initialValues?: InitialValues;
  categories: string[];
  districts: { id: number; name: string }[];
}) {
  const router = useRouter();
  const uid = useId();
  const categoryOptions =
    initialValues && !categories.includes(initialValues.category)
      ? [initialValues.category, ...categories]
      : categories;

  const [name, setName] = useState(initialValues?.name ?? "");
  const [category, setCategory] = useState<string>(initialValues?.category ?? "");
  const [districtId, setDistrictId] = useState(initialValues?.districtId ? String(initialValues.districtId) : "");
  const [location, setLocation] = useState(initialValues?.location ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(initialValues?.whatsapp ?? "");
  const [price, setPrice] = useState(initialValues ? String(initialValues.price) : "");
  const initialYears = initialValues ? parseInt(initialValues.experience, 10) : NaN;
  const [years, setYears] = useState(Number.isNaN(initialYears) ? "" : String(initialYears));
  const [tags, setTags] = useState<string[]>(initialValues?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [about, setAbout] = useState(initialValues?.about ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [loading, setLoading] = useState(false);

  function validate(): Partial<Record<FieldKey, string>> {
    const errs: Partial<Record<FieldKey, string>> = {};
    if (name.trim().length < 2) errs.name = "Enter your business name.";
    if (!category) errs.category = "Choose the category that best fits your business.";
    if (location.trim().length < 2) errs.location = "Enter the town or city you work from.";
    if (phone.trim() && !PHONE_RE.test(phone.trim())) errs.phone = "Enter a 10-digit mobile number.";
    if (whatsapp.trim() && !PHONE_RE.test(whatsapp.trim())) errs.whatsapp = "Enter a 10-digit WhatsApp number.";
    const p = Number(price);
    if (!Number.isInteger(p) || p < 1) errs.price = "Enter a whole number of rupees, 1 or more.";
    const y = Number(years);
    if (years === "" || !Number.isInteger(y) || y < 0 || y > 80) errs.experience = "Enter your years of experience (0 or more).";
    if (about.trim().length < 10) errs.about = "Write at least a short description (10+ characters).";
    return errs;
  }

  function addTag(raw: string) {
    const parts = raw.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length === 0) return;
    setTags((prev) => {
      const next = [...prev];
      for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p);
      return next.slice(0, 15);
    });
    setTagDraft("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const allTags = tagDraft.trim() ? [...tags, ...tagDraft.split(",").map((t) => t.trim()).filter(Boolean)] : tags;
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError("Please fix the highlighted fields.");
      return;
    }
    setLoading(true);

    const url = mode === "edit" ? `/api/vendors/${initialValues!.vendorId}` : "/api/vendors";
    const method = mode === "edit" ? "PATCH" : "POST";
    const yearsNum = parseInt(years, 10);

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          location,
          districtId: districtId ? parseInt(districtId, 10) : null,
          phone: phone.trim() || null,
          whatsapp: whatsapp.trim() || null,
          price: parseInt(price, 10),
          experience: `${yearsNum} ${yearsNum === 1 ? "yr" : "yrs"}`,
          tags: allTags,
          about,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Something went wrong on our side. Please try again.");
        return;
      }
      router.push(mode === "edit" ? "/dashboard?updated=1" : "/dashboard?created=1");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const fid = (k: string) => `${uid}-${k}`;

  return (
    <form onSubmit={handleSubmit} noValidate className="card sm:p-7 space-y-5">
      <div aria-live="polite" className="empty:absolute">
        {error && (
          <div className="alert-error">{error}</div>
        )}
      </div>
      <Field
        id={fid("name")}
        label="Business name"
        value={name}
        onChange={setName}
        required
        autoComplete="organization"
        error={fieldErrors.name}
      />
      <div>
        <label htmlFor={fid("category")} className="label">
          Category
        </label>
        <select
          id={fid("category")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
          aria-invalid={fieldErrors.category ? true : undefined}
          aria-describedby={fieldErrors.category ? `${fid("category")}-err` : undefined}
          className={inputClass}
        >
          {!category && <option value="">Choose a category</option>}
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {fieldErrors.category && (
          <p id={`${fid("category")}-err`} className="text-[13px] text-danger mt-1.5">
            {fieldErrors.category}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-4">
        <div>
          <label htmlFor={fid("district")} className="label">
            District
          </label>
          <select
            id={fid("district")}
            value={districtId}
            onChange={(e) => setDistrictId(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose a district</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <Field
          id={fid("location")}
          label="Town or city"
          hint="Shown on your profile, e.g. Kochi"
          value={location}
          onChange={setLocation}
          required
          autoComplete="address-level2"
          error={fieldErrors.location}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-4">
        <Field
          id={fid("phone")}
          label="Phone (optional)"
          hint="Customers can call you directly"
          value={phone}
          onChange={setPhone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          error={fieldErrors.phone}
        />
        <Field
          id={fid("whatsapp")}
          label="WhatsApp (optional)"
          value={whatsapp}
          onChange={setWhatsapp}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          error={fieldErrors.whatsapp}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-4">
        <Field
          id={fid("price")}
          label="Starting price (₹)"
          hint="Whole rupees, e.g. 25000"
          value={price}
          onChange={setPrice}
          required
          type="number"
          inputMode="numeric"
          min={1}
          error={fieldErrors.price}
        />
        <Field
          id={fid("experience")}
          label="Years of experience"
          value={years}
          onChange={setYears}
          required
          type="number"
          inputMode="numeric"
          min={0}
          error={fieldErrors.experience}
        />
      </div>
      <div>
        <label htmlFor={fid("tags")} className="label">
          Tags (optional)
        </label>
        <p id={`${fid("tags")}-hint`} className="hint mt-0 mb-2">
          Press Enter or comma after each, e.g. Candid, Drone, Cinematic
        </p>
        <div className="flex flex-wrap items-center gap-1.5 w-full min-h-11 sm:min-h-10 px-2 py-0.5 border border-[#80868b] rounded-control bg-white transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-tint)]">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-0.5 text-[13px] font-medium bg-accent-tint text-accent-hover rounded-full pl-3 pr-0.5"
            >
              {t}
              <button
                type="button"
                onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                aria-label={`Remove tag ${t}`}
                className="w-8 h-8 sm:w-7 sm:h-7 rounded-full text-base hover:bg-white/70 leading-none"
              >
                ×
              </button>
            </span>
          ))}
          <input
            id={fid("tags")}
            aria-describedby={`${fid("tags")}-hint`}
            value={tagDraft}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(",")) addTag(v);
              else setTagDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(tagDraft);
              } else if (e.key === "Backspace" && !tagDraft && tags.length > 0) {
                setTags((prev) => prev.slice(0, -1));
              }
            }}
            onBlur={() => addTag(tagDraft)}
            className="flex-1 min-w-[120px] min-h-11 sm:min-h-8 px-1.5 py-1 text-sm outline-none bg-transparent"
          />
        </div>
      </div>
      <div>
        <label htmlFor={fid("about")} className="label">
          About your business
        </label>
        <textarea
          id={fid("about")}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          required
          minLength={10}
          rows={4}
          aria-invalid={fieldErrors.about ? true : undefined}
          aria-describedby={fieldErrors.about ? `${fid("about")}-err` : undefined}
          className={inputClass}
        />
        {fieldErrors.about && (
          <p id={`${fid("about")}-err`} className="text-[13px] text-danger mt-1.5">
            {fieldErrors.about}
          </p>
        )}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-5 border-t border-line">
        <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full sm:w-auto">
          {loading ? (mode === "edit" ? "Saving…" : "Creating…") : mode === "edit" ? "Save changes" : "Create listing"}
        </button>
        <Link href="/dashboard" className="btn btn-ghost w-full sm:w-auto text-ink-soft hover:text-accent">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  required,
  type = "text",
  inputMode,
  autoComplete,
  min,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  min?: number;
  error?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="hint mt-0 mb-2">
          {hint}
        </p>
      )}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        min={min}
        step={type === "number" ? 1 : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={inputClass}
      />
      {error && (
        <p id={`${id}-err`} className="text-[13px] text-danger mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}
