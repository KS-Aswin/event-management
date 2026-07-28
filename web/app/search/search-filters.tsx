"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CATEGORIES } from "@/lib/vendorVisuals";

export default function SearchFilters({ locations }: { locations: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeCategories = searchParams.getAll("category");
  const activeLocation = searchParams.get("location") ?? "";
  const activeMinRating = searchParams.get("minRating") ?? "0";
  const activeSort = searchParams.get("sort") ?? "rating";

  const activeCount =
    activeCategories.length + (activeLocation ? 1 : 0) + (parseFloat(activeMinRating) > 0 ? 1 : 0);

  function updateParams(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    router.push(`/search?${params.toString()}`);
  }

  function toggleCategory(category: string) {
    updateParams((params) => {
      const current = params.getAll("category");
      params.delete("category");
      if (current.includes(category)) {
        current.filter((c) => c !== category).forEach((c) => params.append("category", c));
      } else {
        [...current, category].forEach((c) => params.append("category", c));
      }
    });
  }

  function clearAll() {
    router.push("/search");
  }

  const panel = (
    <>
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-[13px] uppercase tracking-wide text-ink-soft mt-0 mb-2.5">Category</h4>
        <button onClick={clearAll} className="text-[12.5px] text-accent hover:underline">
          Clear all
        </button>
      </div>
      <div className="mb-2">
        {CATEGORIES.map((c) => {
          const checked = activeCategories.includes(c);
          return (
            <label
              key={c}
              onClick={(e) => {
                e.preventDefault();
                toggleCategory(c);
              }}
              className={`flex items-center gap-2.5 w-full text-sm px-3 py-2.5 border rounded-lg mb-2 cursor-pointer transition-colors ${
                checked
                  ? "bg-accent-tint border-accent text-accent font-semibold"
                  : "border-line hover:border-accent"
              }`}
            >
              <span
                className={`w-[18px] h-[18px] border rounded flex items-center justify-center shrink-0 ${
                  checked ? "bg-accent border-accent" : "border-line"
                }`}
              >
                {checked && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              {c}
            </label>
          );
        })}
      </div>

      <h4 className="text-[13px] uppercase tracking-wide text-ink-soft mt-5 mb-2.5">Location</h4>
      <select
        value={activeLocation}
        onChange={(e) => updateParams((p) => (e.target.value ? p.set("location", e.target.value) : p.delete("location")))}
        className="w-full px-2.5 py-2 border border-line rounded-md text-sm"
      >
        <option value="">All Kerala</option>
        {locations.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <h4 className="text-[13px] uppercase tracking-wide text-ink-soft mt-5 mb-2.5">Minimum rating</h4>
      <select
        value={activeMinRating}
        onChange={(e) => updateParams((p) => p.set("minRating", e.target.value))}
        className="w-full px-2.5 py-2 border border-line rounded-md text-sm"
      >
        <option value="0">Any</option>
        <option value="4.5">4.5+</option>
        <option value="4.7">4.7+</option>
        <option value="4.8">4.8+</option>
      </select>

      <h4 className="text-[13px] uppercase tracking-wide text-ink-soft mt-5 mb-2.5">Sort by</h4>
      <select
        value={activeSort}
        onChange={(e) => updateParams((p) => p.set("sort", e.target.value))}
        className="w-full px-2.5 py-2 border border-line rounded-md text-sm"
      >
        <option value="rating">Highest rated</option>
        <option value="reviews">Most reviewed</option>
        <option value="priceLow">Price: low to high</option>
        <option value="priceHigh">Price: high to low</option>
      </select>
    </>
  );

  return (
    <>
      <button
        onClick={() => setMobileOpen((v) => !v)}
        className="md:hidden flex items-center gap-2 border border-line rounded-lg px-3.5 py-2.5 text-sm mb-4"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        Filters
        {activeCount > 0 && (
          <span className="bg-accent text-white rounded-full text-[11px] px-1.5">{activeCount}</span>
        )}
      </button>

      <aside className={`w-full md:w-[230px] shrink-0 ${mobileOpen ? "block" : "hidden"} md:block mb-5 md:mb-0`}>
        {panel}
      </aside>
    </>
  );
}
