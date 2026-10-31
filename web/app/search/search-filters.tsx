"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { CATEGORIES } from "@/lib/vendorVisuals";

export default function SearchFilters({
  locations,
  activeLocation,
  activeMinRating,
  mobileToolbar,
}: {
  locations: string[];
  /** Normalised by the server (canonical district or ""), so the select matches the results. */
  activeLocation: string;
  /** Normalised by the server to an offered threshold, or "0". */
  activeMinRating: string;
  /** Rendered beside the Filters toggle on phones (the sort control). */
  mobileToolbar?: ReactNode;
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
      <div className="flex items-center justify-between gap-3 mb-3 md:mb-4 min-h-10">
        <h2 className="text-[15px] font-semibold">Refine results</h2>
        <button
          type="button"
          onClick={clearAll}
          disabled={activeCount === 0}
          className="btn btn-ghost btn-sm -mr-2 disabled:invisible"
        >
          Clear all
        </button>
      </div>
      <fieldset>
        <legend className="eyebrow mb-2.5">Category</legend>
        <div className="grid grid-cols-2 md:grid-cols-1 gap-2 md:gap-1.5">
        {CATEGORIES.map((c) => {
          const checked = activeCategories.includes(c);
          return (
            <label
              key={c}
              className={`flex items-center gap-2.5 w-full min-h-11 md:min-h-10 text-sm px-3 border rounded-control cursor-pointer select-none transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-1 ${
                checked
                  ? "bg-accent-tint border-accent text-accent font-semibold"
                  : "bg-surface border-line text-foreground hover:border-line-strong hover:bg-surface-muted"
              }`}
            >
              <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleCategory(c)} />
              <span
                aria-hidden="true"
                className={`w-[18px] h-[18px] border rounded flex items-center justify-center shrink-0 ${
                  checked ? "bg-accent border-accent" : "bg-surface border-line-strong"
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
      </fieldset>

      <label htmlFor="filter-location" className="eyebrow block mt-6 mb-2.5">
        Location
      </label>
      <select
        id="filter-location"
        value={activeLocation}
        onChange={(e) => updateParams((p) => (e.target.value ? p.set("location", e.target.value) : p.delete("location")))}
        className="field"
      >
        <option value="">All Kerala</option>
        {locations.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <label htmlFor="filter-rating" className="eyebrow block mt-6 mb-2.5">
        Minimum rating
      </label>
      <select
        id="filter-rating"
        value={activeMinRating}
        onChange={(e) =>
          updateParams((p) => (e.target.value !== "0" ? p.set("minRating", e.target.value) : p.delete("minRating")))
        }
        className="field"
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
      <div className="md:hidden flex items-center justify-between gap-2 mb-3">
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
        aria-controls="search-filters-panel"
        className={`btn btn-secondary px-3.5 ${mobileOpen || activeCount > 0 ? "border-accent text-accent" : ""}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        Filters
        {activeCount > 0 && (
          <span className="bg-accent text-white rounded-full text-[12px] font-semibold min-w-5 h-5 px-1.5 inline-flex items-center justify-center">{activeCount}</span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" className={`transition-transform ${mobileOpen ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {mobileToolbar}
      </div>

      <aside
        id="search-filters-panel"
        aria-label="Filters"
        className={`w-full md:w-[240px] shrink-0 ${mobileOpen ? "block" : "hidden"} md:block mb-5 md:mb-0 rounded-card border border-line bg-surface p-4 md:p-0 md:border-0 md:bg-transparent md:sticky md:top-[calc(var(--header-h)+24px)] transition-opacity ${pending ? "opacity-70" : ""}`}
      >
        {panel}
      </aside>
    </>
  );
}
