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

export default function Home() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  function search(category?: string) {
    const params = new URLSearchParams();
    if (value) params.set("q", value);
    if (category) params.set("category", category);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-5 py-14">
      <h1 className="font-display text-[72px] font-semibold text-accent leading-none mb-1.5">
        Vel<span className="text-gold">a</span>
      </h1>
      <p className="text-ink-soft mb-8 text-center text-base">
        Kerala&apos;s marketplace for weddings &amp; events
      </p>

      <div className="w-full max-w-[584px]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
          className={`flex items-center gap-3 border rounded-full px-5 py-3 transition-shadow ${
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
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            autoComplete="off"
            className="flex-1 outline-none text-base bg-transparent"
          />
        </form>
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
