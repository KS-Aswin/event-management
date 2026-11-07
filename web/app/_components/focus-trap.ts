// Keeps Tab / Shift+Tab inside a modal container (QA-016, QA-027).
//
// A native <dialog> opened with showModal() makes the page behind it inert,
// but browsers still let Tab leave the last control for the browser chrome
// (focus lands on <body> with no visible ring) before coming back. Wrapping
// focus ourselves gives a closed loop: last -> first, first -> last.
//
// Usage: <dialog onKeyDown={trapTabKey}> or on any role="dialog" container.

import type { KeyboardEvent } from "react";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "summary",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Tabbable descendants of `root`, in DOM order, skipping hidden ones. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.closest("[inert]")) return false;
    // Hidden by display:none / visibility (offsetParent is null for those,
    // except position:fixed elements, which getClientRects still reports).
    if (el.getClientRects().length === 0) return false;
    return getComputedStyle(el).visibility !== "hidden";
  });
}

export function trapTabKey(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab" || e.defaultPrevented) return;
  const root = e.currentTarget;
  const list = tabbables(root);
  if (list.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && root.contains(active);
  if (e.shiftKey && (!inside || active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}
