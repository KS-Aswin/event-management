"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export default function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex min-w-0 items-center justify-end gap-2 text-sm text-ink-soft whitespace-nowrap">
      <span className="sr-only sm:not-sr-only">Sort by</span>
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
        className={`field w-auto min-w-0 inline-block pr-8 text-foreground ${pending ? "opacity-60" : ""}`}
      >
        <option value="rating">Highest rated</option>
        <option value="reviews">Most reviewed</option>
        <option value="priceLow">Price: low to high</option>
        <option value="priceHigh">Price: high to low</option>
      </select>
    </label>
  );
}
