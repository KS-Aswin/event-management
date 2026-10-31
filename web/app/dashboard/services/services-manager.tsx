"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { ServiceRecord } from "@/lib/db";

const inputClass =
  "w-full px-3 py-2.5 border border-[#80868b] rounded-md text-sm outline-none focus:border-accent bg-white";

async function send(
  url: string,
  method: string,
  body?: unknown
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && typeof data.error !== "string") data.error = "Something went wrong. Please try again.";
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Couldn't reach the server. Check your connection and try again." } };
  }
}

export default function ServicesManager({
  vendorId,
  initialServices,
  categories,
  defaultCategory,
  units,
}: {
  vendorId: number;
  initialServices: ServiceRecord[];
  categories: string[];
  defaultCategory: string;
  units: string[];
}) {
  const router = useRouter();
  const id = useId();
  const [services, setServices] = useState(initialServices);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(
    categories.includes(defaultCategory) ? defaultCategory : (categories[0] ?? "")
  );
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState(units[0] ?? "event");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; msg: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAdding(true);
    try {
      const { ok, data } = await send(`/api/vendors/${vendorId}/services`, "POST", {
        title,
        category,
        priceFrom: parseInt(price, 10),
        priceUnit: unit,
        description,
      });
      if (!ok) {
        setError(String(data.error));
        return;
      }
      setServices((s) => [...s, data.service as ServiceRecord]);
      setTitle("");
      setPrice("");
      setDescription("");
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  async function toggle(s: ServiceRecord) {
    setRowBusy(s.id);
    setRowError(null);
    const { ok, data } = await send(`/api/services/${s.id}`, "PATCH", { active: !s.active });
    setRowBusy(null);
    if (!ok) {
      setRowError({ id: s.id, msg: String(data.error) });
      return;
    }
    setServices((list) => list.map((x) => (x.id === s.id ? (data.service as ServiceRecord) : x)));
    router.refresh();
  }

  async function remove(s: ServiceRecord) {
    if (!window.confirm(`Delete "${s.title}"? This can't be undone. Use Hide to keep it for later.`)) return;
    setRowBusy(s.id);
    setRowError(null);
    const { ok, data } = await send(`/api/services/${s.id}`, "DELETE");
    setRowBusy(null);
    if (!ok) {
      setRowError({ id: s.id, msg: String(data.error) });
      return;
    }
    setServices((list) => list.filter((x) => x.id !== s.id));
    router.refresh();
  }

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-2.5">Current services</h2>
      {services.length === 0 ? (
        <p className="text-sm text-ink-soft mb-6">No services yet. Add your first one below.</p>
      ) : (
        <ul className="space-y-2.5 mb-8">
          {services.map((s) => (
            <li key={s.id} className="border border-line rounded-xl p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">
                    {s.title}
                    {!s.active && (
                      <span className="ml-2 text-[11.5px] font-medium px-2 py-0.5 rounded-full border bg-gray-100 text-gray-700 border-gray-300">
                        Hidden from customers
                      </span>
                    )}
                  </div>
                  <div className="text-ink-soft text-xs mt-0.5">
                    {s.category} · from ₹{Number(s.price_from).toLocaleString("en-IN")} per {s.price_unit}
                  </div>
                  {s.description && <p className="text-[13px] mt-1 line-clamp-2">{s.description}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggle(s)}
                    disabled={rowBusy === s.id}
                    className="min-h-11 px-3 rounded-md border border-line text-[13px] hover:border-accent disabled:opacity-60"
                  >
                    {s.active ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    disabled={rowBusy === s.id}
                    className="min-h-11 px-3 rounded-md border border-line text-[13px] text-red-700 hover:border-red-300 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div aria-live="polite" className="text-xs text-red-700">
                {rowError?.id === s.id ? rowError.msg : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="space-y-3.5 border border-line rounded-xl p-5.5">
        <h2 className="text-[15px] font-semibold">Add a service</h2>
        <div aria-live="polite">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</div>
          )}
        </div>
        <div>
          <label htmlFor={`${id}-title`} className="block text-[13px] text-ink-soft mb-1.5">
            Service name
          </label>
          <input
            id={`${id}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={2}
            maxLength={120}
            placeholder="e.g. Wedding photography (full day)"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-cat`} className="block text-[13px] text-ink-soft mb-1.5">
            Category
          </label>
          <select id={`${id}-cat`} value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-price`} className="block text-[13px] text-ink-soft mb-1.5">
              Starting price (₹)
            </label>
            <input
              id={`${id}-price`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-unit`} className="block text-[13px] text-ink-soft mb-1.5">
              Price per
            </label>
            <select id={`${id}-unit`} value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass}>
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-desc`} className="block text-[13px] text-ink-soft mb-1.5">
            Description (optional)
          </label>
          <textarea
            id={`${id}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={3}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={adding}
          className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-70"
        >
          {adding ? "Adding…" : "Add service"}
        </button>
      </form>
    </>
  );
}
