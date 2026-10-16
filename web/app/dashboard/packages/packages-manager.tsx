"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Pkg {
  id: number;
  name: string;
  price: number;
  items: string[];
}

export default function PackagesManager({
  vendorId,
  initialPackages,
}: {
  vendorId: number;
  initialPackages: Pkg[];
}) {
  const router = useRouter();
  const [packages, setPackages] = useState<Pkg[]>(initialPackages);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [items, setItems] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/vendors/${vendorId}/packages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        price: parseInt(price, 10),
        items: items.split("\n").map((i) => i.trim()).filter(Boolean),
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setPackages((prev) => [...prev, data.package].sort((a, b) => a.price - b.price));
    setName("");
    setPrice("");
    setItems("");
    router.refresh();
  }

  async function remove(id: number) {
    const res = await fetch(`/api/vendors/${vendorId}/packages/${id}`, { method: "DELETE" });
    if (res.ok) {
      setPackages((prev) => prev.filter((p) => p.id !== id));
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="border border-line rounded-xl p-5.5">
        {packages.length === 0 ? (
          <p className="text-sm text-ink-soft">No packages yet. Add your first one below.</p>
        ) : (
          packages.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-start justify-between gap-3 py-3 text-sm ${
                i < packages.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <div>
                <div className="font-semibold">
                  {p.name} · <span className="text-accent">₹{p.price.toLocaleString("en-IN")}</span>
                </div>
                {p.items.length > 0 && (
                  <ul className="text-[13px] text-ink-soft mt-1 space-y-0.5">
                    {p.items.map((it) => (
                      <li key={it}>✓ {it}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button onClick={() => remove(p.id)} className="text-xs text-red-700 hover:underline shrink-0">
                Delete
              </button>
            </div>
          ))
        )}
      </div>

      <form onSubmit={add} className="border border-line rounded-xl p-5.5 space-y-3">
        <h3 className="text-[15px] font-semibold">Add a package</h3>
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Package name (e.g. Gold wedding)"
          className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
        />
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
          min={1}
          placeholder="Price in ₹"
          className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
        />
        <textarea
          value={items}
          onChange={(e) => setItems(e.target.value)}
          rows={4}
          placeholder={"What's included — one per line\nFull-day coverage\nEdited photo album"}
          className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={saving}
          className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-70"
        >
          {saving ? "Adding…" : "Add package"}
        </button>
      </form>
    </div>
  );
}
