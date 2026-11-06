"use client";

// Search filters (P2-7). A sidebar from md up; on phones a bottom sheet
// opened by the "Filters" button, with a sticky "Show N results" footer.
// Every change replaces the URL (no history entry per click); the server
// page re-renders with the new results.

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";

export interface BudgetPreset {
  value: number;
  label: string;
}

export interface ActiveFilters {
  categories: string[];
  /** Canonical district name or "". */
  location: string;
  homeOnly: boolean;
  /** An offered threshold or "0". */
  minRating: string;
  offering: string;
  eventType: string;
  date: string;
  budgetMax: string;
  guests: string;
  verified: boolean;
}

const FILTER_KEYS = [
  "category", "location", "homeOnly", "minRating", "offering", "eventType", "date", "budgetMax", "priceUnit", "guests", "verified",
];

export default function SearchFilters({
  categories,
  districts,
  eventTypes,
  templates,
  active,
  budgetUnit,
  budgetPresets,
  today,
  resultLabel,
  mobileToolbar,
}: {
  /** Active category names from the DB taxonomy. */
  categories: string[];
  /** Kerala district names. */
  districts: string[];
  eventTypes: { slug: string; name: string }[];
  /** Offering templates of the selected categories (empty when none is selected). */
  templates: { code: string; name: string }[];
  /** Normalised by the server, so the controls match the results. */
  active: ActiveFilters;
  /** Unit budgets are compared in ("plate" for catering). */
  budgetUnit: string;
  budgetPresets: BudgetPreset[];
  /** YYYY-MM-DD in India; the earliest date the picker allows. */
  today: string;
  /** "12 vendors", for the sheet's footer button. */
  resultLabel: string;
  /** Rendered beside the Filters toggle on phones (the sort control). */
  mobileToolbar?: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Checkboxes flip at once while the new results load.
  const [toggles, setToggles] = useOptimistic(
    { verified: active.verified, homeOnly: active.homeOnly },
    (s, patch: Partial<{ verified: boolean; homeOnly: boolean }>) => ({ ...s, ...patch })
  );
  const sheetRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [guests, setGuests] = useState(active.guests);
  const [guestsFor, setGuestsFor] = useState(active.guests);
  // Keep the input in step when the URL changes (e.g. a chip removed it).
  if (guestsFor !== active.guests) {
    setGuestsFor(active.guests);
    setGuests(active.guests);
  }

  const activeCount =
    active.categories.length +
    [active.location, active.offering, active.eventType, active.date, active.budgetMax, active.guests].filter(Boolean).length +
    (parseFloat(active.minRating) > 0 ? 1 : 0) +
    (active.verified ? 1 : 0);

  // Sheet: Escape closes it, the page behind doesn't scroll, focus moves in.
  useEffect(() => {
    if (!mobileOpen) return;
    const mq = window.matchMedia("(max-width: 767.98px)");
    if (!mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  function updateParams(mutator: (params: URLSearchParams) => void, optimistic?: () => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      optimistic?.();
      router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
    });
  }
  const setParam = (key: string, value: string | null) =>
    updateParams((p) => (value ? p.set(key, value) : p.delete(key)));

  function toggleCategory(category: string) {
    updateParams((params) => {
      const current = params.getAll("category");
      params.delete("category");
      const next = current.includes(category) ? current.filter((c) => c !== category) : [...current, category];
      next.forEach((c) => params.append("category", c));
      // Offering chips and budget units depend on the categories.
      params.delete("offering");
      params.delete("budgetMax");
      params.delete("priceUnit");
    });
  }

  // Clears the filters only; keeps the query, view and sort order.
  function clearAll() {
    updateParams((params) => FILTER_KEYS.forEach((k) => params.delete(k)));
  }

  function applyGuests() {
    const n = guests.trim();
    if (n === active.guests) return;
    if (n === "" || (/^\d{1,6}$/.test(n) && Number(n) >= 1 && Number(n) <= 100000)) setParam("guests", n || null);
  }

  const guestsInvalid = guests.trim() !== "" && !(/^\d{1,6}$/.test(guests.trim()) && Number(guests) >= 1 && Number(guests) <= 100000);

  const panel = (
    <>
      <div className="flex items-center justify-between gap-3 mb-3 md:mb-4 min-h-10">
        <h2 className="text-[15px] font-semibold">Refine results</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={clearAll} disabled={activeCount === 0} className="btn btn-ghost btn-sm disabled:invisible">
            Clear all
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              toggleRef.current?.focus();
            }}
            aria-label="Close filters"
            className="md:hidden inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-full text-ink-soft hover:bg-surface-muted"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <fieldset>
        <legend className="eyebrow mb-2.5">Category</legend>
        <div className="grid grid-cols-2 md:grid-cols-1 gap-2 md:gap-1.5">
          {categories.map((c) => {
            const checked = active.categories.includes(c);
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

      {templates.length > 0 && (
        <div className="mt-6" role="group" aria-labelledby="filter-offering-label">
          <div id="filter-offering-label" className="eyebrow mb-2.5">
            Service
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => {
              const on = active.offering === t.code;
              return (
                <button
                  key={t.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => updateParams((p) => {
                    if (on) p.delete("offering");
                    else p.set("offering", t.code);
                    p.delete("budgetMax");
                    p.delete("priceUnit");
                  })}
                  className={`inline-flex items-center min-h-11 md:min-h-9 px-3.5 rounded-full border text-[13px] transition-colors ${
                    on ? "bg-accent-tint border-accent text-accent font-semibold" : "bg-surface border-line hover:border-line-strong"
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label htmlFor="filter-location" className="eyebrow block mt-6 mb-2.5">
        Location
      </label>
      <select
        id="filter-location"
        value={active.location}
        onChange={(e) => setParam("location", e.target.value || null)}
        className="field"
      >
        <option value="">All Kerala</option>
        {districts.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      {active.location && (
        <label className="flex items-center gap-2.5 min-h-11 mt-1 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="w-[18px] h-[18px] accent-[var(--color-accent)]"
            checked={!toggles.homeOnly}
            onChange={(e) => {
              const on = e.target.checked;
              updateParams((p) => (on ? p.delete("homeOnly") : p.set("homeOnly", "1")), () => setToggles({ homeOnly: !on }));
            }}
          />
          Include vendors who travel here
        </label>
      )}

      <label htmlFor="filter-date" className="eyebrow block mt-6 mb-2.5">
        Event date
      </label>
      <input
        id="filter-date"
        type="date"
        min={today}
        value={active.date}
        onChange={(e) => {
          const v = e.target.value;
          if (!v || v >= today) setParam("date", v || null);
        }}
        className="field"
        aria-describedby="filter-date-hint"
      />
      <p id="filter-date-hint" className="hint">
        Hides vendors who are fully booked that day.
      </p>

      <label htmlFor="filter-event-type" className="eyebrow block mt-6 mb-2.5">
        Occasion
      </label>
      <select
        id="filter-event-type"
        value={active.eventType}
        onChange={(e) => setParam("eventType", e.target.value || null)}
        className="field"
      >
        <option value="">Any occasion</option>
        {eventTypes.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.name}
          </option>
        ))}
      </select>

      <label htmlFor="filter-budget" className="eyebrow block mt-6 mb-2.5">
        Budget ({budgetUnit === "event" ? "per event" : `per ${budgetUnit}`})
      </label>
      <select
        id="filter-budget"
        value={active.budgetMax}
        onChange={(e) =>
          updateParams((p) => {
            if (e.target.value) {
              p.set("budgetMax", e.target.value);
              p.set("priceUnit", budgetUnit);
            } else {
              p.delete("budgetMax");
              p.delete("priceUnit");
            }
          })
        }
        className="field"
      >
        <option value="">Any budget</option>
        {active.budgetMax && !budgetPresets.some((b) => String(b.value) === active.budgetMax) && (
          <option value={active.budgetMax}>Up to ₹{Number(active.budgetMax).toLocaleString("en-IN")}</option>
        )}
        {budgetPresets.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </select>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          applyGuests();
        }}
      >
        <label htmlFor="filter-guests" className="eyebrow block mb-2.5">
          Guests
        </label>
        <div className="flex gap-2">
          <input
            id="filter-guests"
            type="number"
            inputMode="numeric"
            min={1}
            max={100000}
            placeholder="e.g. 400"
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            onBlur={applyGuests}
            aria-invalid={guestsInvalid || undefined}
            aria-describedby={guestsInvalid ? "filter-guests-error" : undefined}
            className="field"
          />
          <button type="submit" className="btn btn-secondary shrink-0">
            Apply
          </button>
        </div>
        {guestsInvalid && (
          <p id="filter-guests-error" className="hint text-danger">
            Enter a number from 1 to 100,000.
          </p>
        )}
      </form>

      <label htmlFor="filter-rating" className="eyebrow block mt-6 mb-2.5">
        Minimum rating
      </label>
      <select
        id="filter-rating"
        value={active.minRating}
        onChange={(e) => setParam("minRating", e.target.value !== "0" ? e.target.value : null)}
        className="field"
      >
        <option value="0">Any</option>
        <option value="4.5">4.5+</option>
        <option value="4.7">4.7+</option>
        <option value="4.8">4.8+</option>
      </select>

      <label className="flex items-center gap-2.5 min-h-11 mt-4 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="w-[18px] h-[18px] accent-[var(--color-accent)]"
          checked={toggles.verified}
          onChange={(e) => {
            const on = e.target.checked;
            updateParams((p) => (on ? p.set("verified", "1") : p.delete("verified")), () => setToggles({ verified: on }));
          }}
        />
        Verified businesses only
      </label>

      {pending && (
        <p className="text-[12.5px] text-ink-soft mt-4 hidden md:block" role="status">
          Updating results…
        </p>
      )}

      <div className="md:hidden sticky bottom-0 -mx-4 mt-6 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] bg-surface border-t border-line">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => {
            setMobileOpen(false);
            toggleRef.current?.focus();
          }}
          aria-busy={pending}
        >
          {pending ? "Updating…" : `Show ${resultLabel}`}
        </button>
      </div>
    </>
  );

  return (
    <>
      <div className="md:hidden flex items-center justify-between gap-2 mb-3">
        <button
          ref={toggleRef}
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
            <span className="bg-accent text-white rounded-full text-[12px] font-semibold min-w-5 h-5 px-1.5 inline-flex items-center justify-center">
              {activeCount}
            </span>
          )}
        </button>
        {mobileToolbar}
      </div>

      {mobileOpen && (
        <div
          aria-hidden="true"
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        id="search-filters-panel"
        ref={sheetRef}
        tabIndex={-1}
        aria-label="Filters"
        className={`${
          mobileOpen
            ? "fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-[20px] bg-surface px-4 pt-3 shadow-pop"
            : "hidden"
        } md:block md:w-[240px] md:shrink-0 md:max-h-[calc(100dvh-var(--header-h)-48px)] md:overflow-y-auto md:pr-2 md:-mr-2 md:rounded-none md:p-0 md:shadow-none md:bg-transparent md:sticky md:top-[calc(var(--header-h)+24px)] md:z-auto transition-opacity ${pending ? "md:opacity-70" : ""}`}
      >
        {mobileOpen && <div aria-hidden="true" className="md:hidden mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />}
        {panel}
      </aside>
    </>
  );
}
