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

// Darker than --color-line so input edges meet the 3:1 non-text contrast minimum.
const inputClass =
  "w-full px-3 py-2.5 border border-[#80868b] rounded-md text-sm outline-none focus:border-accent bg-white aria-[invalid=true]:border-red-600";

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
    <form onSubmit={handleSubmit} noValidate className="space-y-3.5 border border-line rounded-xl p-5.5">
      <div aria-live="polite">
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</div>
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
        <label htmlFor={fid("category")} className="block text-[13px] text-ink-soft mb-1.5">
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
          <p id={`${fid("category")}-err`} className="text-xs text-red-700 mt-1">
            {fieldErrors.category}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div>
          <label htmlFor={fid("district")} className="block text-[13px] text-ink-soft mb-1.5">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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
        <label htmlFor={fid("tags")} className="block text-[13px] text-ink-soft mb-1.5">
          Tags (optional)
        </label>
        <p id={`${fid("tags")}-hint`} className="text-xs text-ink-soft -mt-1 mb-1.5">
          Press Enter or comma after each, e.g. Candid, Drone, Cinematic
        </p>
        <div className="flex flex-wrap items-center gap-1.5 w-full px-2 py-1.5 border border-[#80868b] rounded-md focus-within:border-accent bg-white">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 text-[13px] bg-accent-tint text-accent rounded-full pl-2.5 pr-1 py-0.5"
            >
              {t}
              <button
                type="button"
                onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                aria-label={`Remove tag ${t}`}
                className="w-6 h-6 rounded-full hover:bg-white/70 leading-none"
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
            className="flex-1 min-w-[120px] px-1 py-1 text-sm outline-none bg-transparent"
          />
        </div>
      </div>
      <div>
        <label htmlFor={fid("about")} className="block text-[13px] text-ink-soft mb-1.5">
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
          <p id={`${fid("about")}-err`} className="text-xs text-red-700 mt-1">
            {fieldErrors.about}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-70"
        >
          {loading ? (mode === "edit" ? "Saving…" : "Creating…") : mode === "edit" ? "Save changes" : "Create listing"}
        </button>
        <Link href="/dashboard" className="px-3 py-2.5 text-sm text-ink-soft hover:text-accent">
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
      <label htmlFor={id} className="block text-[13px] text-ink-soft mb-1.5">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink-soft -mt-1 mb-1.5">
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
        <p id={`${id}-err`} className="text-xs text-red-700 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
