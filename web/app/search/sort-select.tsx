"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export default function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm text-ink-soft">
      Sort by
      <select
        value={value}
        aria-busy={pending}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          if (e.target.value === "rating") params.delete("sort");
          else params.set("sort", e.target.value);
          params.delete("page");
          const qs = params.toString();
          startTransition(() => router.replace(qs ? `/search?${qs}` : "/search"));
        }}
        className={`px-2.5 py-1.5 border border-line rounded-md text-sm text-foreground bg-white ${pending ? "opacity-60" : ""}`}
      >
        <option value="rating">Highest rated</option>
        <option value="reviews">Most reviewed</option>
        <option value="priceLow">Price: low to high</option>
        <option value="priceHigh">Price: high to low</option>
      </select>
    </label>
  );
}
