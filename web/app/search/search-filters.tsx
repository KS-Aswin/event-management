"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { CATEGORIES } from "@/lib/vendorVisuals";

export default function SearchFilters({
  locations,
  activeLocation,
  activeMinRating,
}: {
  locations: string[];
  /** Normalised by the server (canonical district or ""), so the select matches the results. */
  activeLocation: string;
  /** Normalised by the server to an offered threshold, or "0". */
  activeMinRating: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const activeCategories = searchParams.getAll("category");

  const activeCount =
    activeCategories.length + (activeLocation ? 1 : 0) + (parseFloat(activeMinRating) > 0 ? 1 : 0);

  // replace (not push) so each filter click doesn't add a history entry.
  function updateParams(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `/search?${qs}` : "/search"));
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

  // Clears the filters only; keeps the query and sort order.
  function clearAll() {
    updateParams((params) => {
      params.delete("category");
      params.delete("location");
      params.delete("minRating");
    });
  }

  const panel = (
    <>
      <fieldset className="mb-2 relative">
        <legend className="text-[13px] uppercase tracking-wide text-ink-soft mt-0 mb-6">Category</legend>
        <button type="button" onClick={clearAll} className="absolute right-0 -top-9 min-h-10 px-1 text-[12.5px] text-accent hover:underline">
          Clear all
        </button>
        {CATEGORIES.map((c) => {
          const checked = activeCategories.includes(c);
          return (
            <label
              key={c}
              className={`flex items-center gap-2.5 w-full text-sm px-3 py-2.5 border rounded-lg mb-2 cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                checked
                  ? "bg-accent-tint border-accent text-accent font-semibold"
                  : "border-line hover:border-accent"
              }`}
            >
              <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleCategory(c)} />
              <span
                aria-hidden="true"
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
      </fieldset>

      <label htmlFor="filter-location" className="block text-[13px] uppercase tracking-wide text-ink-soft mt-5 mb-2.5">
        Location
      </label>
      <select
        id="filter-location"
        value={activeLocation}
        onChange={(e) => updateParams((p) => (e.target.value ? p.set("location", e.target.value) : p.delete("location")))}
        className="w-full min-h-11 px-2.5 py-2 border border-line rounded-md text-sm"
      >
        <option value="">All Kerala</option>
        {locations.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <label htmlFor="filter-rating" className="block text-[13px] uppercase tracking-wide text-ink-soft mt-5 mb-2.5">
        Minimum rating
      </label>
      <select
        id="filter-rating"
        value={activeMinRating}
        onChange={(e) =>
          updateParams((p) => (e.target.value !== "0" ? p.set("minRating", e.target.value) : p.delete("minRating")))
        }
        className="w-full min-h-11 px-2.5 py-2 border border-line rounded-md text-sm"
      >
        <option value="0">Any</option>
        <option value="4.5">4.5+</option>
        <option value="4.7">4.7+</option>
        <option value="4.8">4.8+</option>
      </select>

      {pending && (
        <p className="text-[12.5px] text-ink-soft mt-4" role="status">
          Updating results…
        </p>
      )}
    </>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
        aria-controls="search-filters-panel"
        className="md:hidden flex items-center gap-2 border border-line rounded-lg px-3.5 py-2.5 text-sm mb-4"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        Filters
        {activeCount > 0 && (
          <span className="bg-accent text-white rounded-full text-[11px] px-1.5">{activeCount}</span>
        )}
      </button>

      <aside
        id="search-filters-panel"
        aria-label="Filters"
        className={`w-full md:w-[230px] shrink-0 ${mobileOpen ? "block" : "hidden"} md:block mb-5 md:mb-0 ${pending ? "opacity-70" : ""}`}
      >
        {panel}
      </aside>
    </>
  );
}
