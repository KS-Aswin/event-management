"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A sideways-scrolling tab strip (QA-097). On a phone the queue tabs are wider
 * than the screen, so after every render this scrolls the strip, not the page,
 * until the current tab ([aria-current=page]) is fully visible.
 */
export function TabNav({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const n = nav.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (a.left >= n.left && a.right <= n.right) return;
    // Centre it where possible; scrollLeft is clamped by the browser.
    nav.scrollLeft += a.left - n.left - Math.max(0, (n.width - a.width) / 2);
  });
  return (
    <nav ref={ref} aria-label={label} className={className}>
      {children}
    </nav>
  );
}
