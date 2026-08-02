"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/lib/vendorVisuals";

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

export default function Home() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions>(EMPTY_SUGGESTIONS);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let exIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function tick() {
      if (document.activeElement === inputRef.current) {
        timeoutId = setTimeout(tick, 400);
        return;
      }
      const full = EXAMPLES[exIndex];
      if (!deleting) {
        charIndex++;
        setPlaceholder(full.slice(0, charIndex));
        if (charIndex === full.length) {
          deleting = true;
          timeoutId = setTimeout(tick, 1400);
          return;
        }
      } else {
        charIndex--;
        setPlaceholder(full.slice(0, charIndex));
        if (charIndex === 0) {
          deleting = false;
          exIndex = (exIndex + 1) % EXAMPLES.length;
        }
      }
      timeoutId = setTimeout(tick, deleting ? 25 : 55);
    }
    tick();
    return () => clearTimeout(timeoutId);
  }, []);

  // Debounced fetch of suggestions as the person types.
  useEffect(() => {
    if (value.trim().length < 2) {
      setSuggestions(EMPTY_SUGGESTIONS);
      setShowSuggestions(false);
      return;
    }
    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(value)}`);
        if (!res.ok) return;
        const data = await res.json();
        setSuggestions(data);
        setShowSuggestions(true);
      } catch {
        // suggestions are a nice-to-have — silently ignore a failed fetch
      }
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [value]);

  // Close the dropdown on an outside click, rather than on input blur —
  // blur fires before a click on a suggestion registers, which would close
  // the dropdown before the click could be handled.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function search(category?: string, location?: string) {
    const params = new URLSearchParams();
    if (value) params.set("q", value);
    if (category) params.set("category", category);
    if (location) params.set("location", location);
    setShowSuggestions(false);
    router.push(`/search?${params.toString()}`);
  }

  const hasSuggestions =
    suggestions.categories.length + suggestions.locations.length + suggestions.vendors.length > 0;

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-5 py-14">
      <h1 className="font-display text-[72px] font-semibold text-accent leading-none mb-1.5">
        Vel<span className="text-gold">a</span>
      </h1>
      <p className="text-ink-soft mb-8 text-center text-base">
        Kerala&apos;s marketplace for weddings &amp; events
      </p>

      <div className="w-full max-w-[584px] relative" ref={wrapperRef}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
          className={`flex items-center gap-3 border rounded-full px-5 py-3 transition-shadow relative z-10 bg-white ${
            focused ? "shadow-[0_1px_6px_rgba(32,33,36,0.18)] border-transparent" : "border-line"
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-soft shrink-0">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => {
              setFocused(true);
              if (hasSuggestions) setShowSuggestions(true);
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            placeholder={placeholder}
            autoComplete="off"
            className="flex-1 outline-none text-base bg-transparent"
          />
        </form>

        {showSuggestions && hasSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-line rounded-2xl shadow-lg py-2 z-20 max-h-[360px] overflow-auto">
            {suggestions.categories.length > 0 && (
              <SuggestionGroup label="Categories">
                {suggestions.categories.map((c) => (
                  <SuggestionRow key={c} onClick={() => search(c)}>
                    {c}
                  </SuggestionRow>
                ))}
              </SuggestionGroup>
            )}
            {suggestions.locations.length > 0 && (
              <SuggestionGroup label="Locations">
                {suggestions.locations.map((l) => (
                  <SuggestionRow key={l} onClick={() => search(undefined, l)}>
                    {l}
                  </SuggestionRow>
                ))}
              </SuggestionGroup>
            )}
            {suggestions.vendors.length > 0 && (
              <SuggestionGroup label="Vendors">
                {suggestions.vendors.map((v) => (
                  <SuggestionRow key={v.id} onClick={() => router.push(`/vendors/${v.id}`)}>
                    {v.name} <span className="text-ink-soft">· {v.category}</span>
                  </SuggestionRow>
                ))}
              </SuggestionGroup>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6.5 flex-wrap justify-center">
        <button
          onClick={() => search()}
          className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm"
        >
          Search vendors
        </button>
        <button
          onClick={() => search()}
          className="px-4.5 py-2.5 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
        >
          Plan my event
        </button>
      </div>

      <div className="flex gap-2.5 mt-10 flex-wrap justify-center max-w-[660px]">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => search(c)}
            className="border border-line rounded-full px-4 py-2 text-[13px] text-ink-soft hover:bg-accent-tint hover:text-accent hover:border-accent-tint whitespace-nowrap"
          >
            {c}
          </button>
        ))}
      </div>
    </main>
  );
}

function SuggestionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-2 py-1">
      <div className="text-[11px] uppercase tracking-wide text-ink-soft px-2.5 pt-1.5 pb-1">{label}</div>
      {children}
    </div>
  );
}

function SuggestionRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-2.5 py-2 text-sm rounded-lg hover:bg-accent-tint hover:text-accent"
    >
      {children}
    </button>
  );
}
