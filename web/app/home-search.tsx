"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

const EXAMPLES = [
  "Photographer in Kochi under ₹50,000",
  "Wedding venue for 600 guests, Kottayam",
  "Caterer available on 10 January",
  "Decorator, 4.8+ rating, Thrissur",
  "Mehendi artist near Kozhikode",
];

interface Suggestions {
  categories: string[];
  locations: string[];
  vendors: { id: number; name: string; category: string }[];
}

const EMPTY_SUGGESTIONS: Suggestions = { categories: [], locations: [], vendors: [] };

/** Trim and collapse inner whitespace so "Kochi " matches like "Kochi". */
function normalise(q: string) {
  return q.trim().replace(/\s+/g, " ");
}

interface Facets {
  q?: string;
  category?: string;
  location?: string;
}

interface Option {
  id: string;
  group: "Categories" | "Locations" | "Vendors" | "all";
  label: React.ReactNode;
  run: () => void;
}

export default function HomeSearch() {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Suggestions are stored together with the query they were fetched for, so
  // "loading" is derived (fetchedFor !== current query) instead of being set
  // synchronously inside an effect.
  const [result, setResult] = useState<{ q: string; data: Suggestions }>({ q: "", data: EMPTY_SUGGESTIONS });
  const wrapperRef = useRef<HTMLDivElement>(null);

  const query = normalise(value);
  const wantsSuggestions = query.length >= 2;
  const loading = wantsSuggestions && result.q !== query;
  const suggestions = wantsSuggestions ? result.data : EMPTY_SUGGESTIONS;

  // Debounced, abortable fetch of suggestions as the person types.
  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const data: Suggestions = res.ok ? await res.json() : EMPTY_SUGGESTIONS;
        setResult({ q: query, data });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        // suggestions are a nice-to-have; fall back to the "search all" row
        setResult({ q: query, data: EMPTY_SUGGESTIONS });
      }
    }, 250);
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [query]);

  // Close the dropdown on an outside click, rather than on input blur:
  // blur fires before a click on a suggestion registers.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Each entry point sends only its own facet: chips/suggestions never carry
  // the typed text along, and Enter / Search sends only q.
  function search(facets: Facets) {
    const params = new URLSearchParams();
    const q = facets.q ? normalise(facets.q) : "";
    if (q) params.set("q", q);
    if (facets.category) params.set("category", facets.category);
    if (facets.location) params.set("location", facets.location);
    setOpen(false);
    const qs = params.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  const options: Option[] = [
    ...suggestions.categories.map((c) => ({
      id: `${listId}-c-${c}`,
      group: "Categories" as const,
      label: c,
      run: () => search({ category: c }),
    })),
    ...suggestions.locations.map((l) => ({
      id: `${listId}-l-${l}`,
      group: "Locations" as const,
      label: l,
      run: () => search({ location: l }),
    })),
    ...suggestions.vendors.map((v) => ({
      id: `${listId}-v-${v.id}`,
      group: "Vendors" as const,
      label: (
        <>
          {v.name} <span className="text-ink-soft">· {v.category}</span>
        </>
      ),
      run: () => {
        setOpen(false);
        router.push(`/vendors/${v.id}`);
      },
    })),
    {
      id: `${listId}-all`,
      group: "all" as const,
      label: <>Search all vendors for &ldquo;{query}&rdquo;</>,
      run: () => search({ q: query }),
    },
  ];

  const showList = open && wantsSuggestions;
  const active = showList && activeIndex >= 0 && activeIndex < options.length ? activeIndex : -1;
  const matchCount = options.length - 1;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!wantsSuggestions) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(e.key === "ArrowDown" ? 0 : options.length - 1);
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const start = active === -1 ? (delta === 1 ? -1 : options.length) : active;
      setActiveIndex((start + delta + options.length) % options.length);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      options[active].run();
    }
  }

  const groups: Option["group"][] = ["Categories", "Locations", "Vendors"];

  return (
    <div className="w-full max-w-[620px] flex flex-col items-center">
      <div className="w-full relative" ref={wrapperRef}>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            search({ q: value });
          }}
          className={`flex items-center gap-3 border rounded-full pl-5 pr-4 min-h-[52px] sm:min-h-14 transition-[box-shadow,border-color] relative z-10 bg-white ${
            focused
              ? "border-accent shadow-[0_0_0_3px_var(--color-accent-tint),0_1px_6px_rgba(32,33,36,0.14)]"
              : "border-line-strong shadow-[0_1px_2px_rgba(32,33,36,0.06)] hover:shadow-[0_1px_6px_rgba(32,33,36,0.14)]"
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-soft shrink-0" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <div className="flex-1 relative min-w-0">
            {value === "" && <AnimatedHint paused={focused} />}
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setOpen(true);
                setActiveIndex(-1);
              }}
              onFocus={() => {
                setFocused(true);
                setOpen(true);
              }}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-label="Search vendors by name, category or district"
              aria-autocomplete="list"
              aria-expanded={showList}
              aria-controls={listId}
              aria-activedescendant={active >= 0 ? options[active].id : undefined}
              autoComplete="off"
              enterKeyHint="search"
              className="w-full min-h-11 outline-none text-base bg-transparent relative"
              // The pill shows focus (green border + ring); a second square
              // outline inside it looked broken.
              style={{ outline: "none" }}
            />
          </div>
        </form>

        <div className="sr-only" aria-live="polite">
          {showList ? (loading ? "Searching" : `${matchCount} suggestion${matchCount === 1 ? "" : "s"}`) : ""}
        </div>

        {showList && (
          <div
            id={listId}
            role="listbox"
            aria-label="Search suggestions"
            className="absolute top-full left-0 right-0 mt-2 bg-white border border-line rounded-card shadow-pop py-2 z-20 max-h-[min(360px,55dvh)] overflow-auto overscroll-contain"
          >
            {groups.map((g) => {
              const items = options.filter((o) => o.group === g);
              if (items.length === 0) return null;
              return (
                <div key={g} role="group" aria-label={g} className="px-2 py-1">
                  <div className="eyebrow px-3 pt-1.5 pb-1" aria-hidden="true">
                    {g}
                  </div>
                  {items.map((o) => (
                    <SuggestionRow key={o.id} option={o} active={options[active]?.id === o.id} />
                  ))}
                </div>
              );
            })}
            {loading && (
              <div className="px-5 py-2.5 text-sm text-ink-soft" aria-hidden="true">
                Searching…
              </div>
            )}
            <div className="px-2 py-1 border-t border-line mt-1 pt-2">
              <SuggestionRow option={options[options.length - 1]} active={active === options.length - 1} />
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => search({ q: value })}
        className="btn btn-primary btn-lg mt-5 sm:mt-6 w-full max-w-[320px] sm:w-auto sm:min-w-[180px]"
      >
        Search vendors
      </button>
    </div>
  );
}

function SuggestionRow({ option, active }: { option: Option; active: boolean }) {
  return (
    <div
      id={option.id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={option.run}
      className={`w-full text-left block px-3 py-[11px] leading-[22px] text-[15px] sm:text-sm rounded-control cursor-pointer hover:bg-accent-tint hover:text-accent ${
        active ? "bg-accent-tint text-accent" : ""
      }`}
    >
      {option.label}
    </div>
  );
}

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * Typewriter hint shown over the empty input. Isolated in its own component so
 * the ticking only re-renders this span, not the whole search box. Shows the
 * full example while the input is focused or when reduced motion is preferred.
 */
function AnimatedHint({ paused }: { paused: boolean }) {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
  const [s, setS] = useState({ ex: 0, chars: 0, deleting: false });
  const full = EXAMPLES[s.ex];
  const still = paused || reduced;

  useEffect(() => {
    if (still) return;
    const delay = !s.deleting ? 55 : s.chars === EXAMPLES[s.ex].length ? 1400 : 25;
    const t = setTimeout(() => {
      setS((cur) => {
        const len = EXAMPLES[cur.ex].length;
        if (!cur.deleting) {
          const chars = cur.chars + 1;
          return { ...cur, chars, deleting: chars >= len };
        }
        const chars = cur.chars - 1;
        return chars <= 0 ? { ex: (cur.ex + 1) % EXAMPLES.length, chars: 0, deleting: false } : { ...cur, chars };
      });
    }, delay);
    return () => clearTimeout(t);
  }, [s, still]);

  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 flex items-center pointer-events-none text-[#757575] text-base whitespace-nowrap overflow-hidden"
    >
      {still ? full : full.slice(0, s.chars)}
    </span>
  );
}
