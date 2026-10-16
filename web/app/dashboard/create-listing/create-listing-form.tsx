"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/lib/vendorVisuals";

const PRICE_UNIT_OPTIONS = ["onwards", "per plate", "per event", "per day"] as const;

interface InitialValues {
  vendorId: number;
  name: string;
  category: string;
  location: string;
  price: number;
  priceUnit: string;
  experience: string;
  tags: string[];
  about: string;
}

export default function ListingForm({
  mode,
  initialValues,
}: {
  mode: "create" | "edit";
  initialValues?: InitialValues;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialValues?.name ?? "");
  const [category, setCategory] = useState<string>(initialValues?.category ?? CATEGORIES[0]);
  const [location, setLocation] = useState(initialValues?.location ?? "");
  const [price, setPrice] = useState(initialValues ? String(initialValues.price) : "");
  const [priceUnit, setPriceUnit] = useState<string>(initialValues?.priceUnit ?? "onwards");
  const [experience, setExperience] = useState(initialValues?.experience ?? "");
  const [tags, setTags] = useState(initialValues?.tags.join(", ") ?? "");
  const [about, setAbout] = useState(initialValues?.about ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const url = mode === "edit" ? `/api/vendors/${initialValues!.vendorId}` : "/api/vendors";
    const method = mode === "edit" ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        category,
        location,
        price: parseInt(price, 10),
        priceUnit,
        experience,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        about,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5 border border-line rounded-xl p-5.5">
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <Field label="Business name" value={name} onChange={setName} required />
      <div>
        <label className="block text-[13px] text-ink-soft mb-1.5">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-2.5 py-2 border border-line rounded-md text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <Field label="Location (e.g. Kochi)" value={location} onChange={setLocation} required />
      <Field
        label="Starting price (₹, numbers only)"
        value={price}
        onChange={setPrice}
        required
        type="number"
      />
      <div>
        <label className="block text-[13px] text-ink-soft mb-1.5">Price type</label>
        <select
          value={priceUnit}
          onChange={(e) => setPriceUnit(e.target.value)}
          className="w-full px-2.5 py-2 border border-line rounded-md text-sm"
        >
          {PRICE_UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u === "onwards" ? "Starting price (onwards)" : u.charAt(0).toUpperCase() + u.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <Field label="Years of experience (e.g. 5 yrs)" value={experience} onChange={setExperience} required />
      <Field label="Tags (comma-separated, e.g. Candid, Drone, Cinematic)" value={tags} onChange={setTags} />
      <div>
        <label className="block text-[13px] text-ink-soft mb-1.5">About your business</label>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          required
          minLength={10}
          rows={4}
          className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-70"
      >
        {loading ? (mode === "edit" ? "Saving…" : "Creating…") : mode === "edit" ? "Save changes" : "Create listing"}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[13px] text-ink-soft mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
      />
    </div>
  );
}
