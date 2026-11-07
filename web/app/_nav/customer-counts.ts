"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { SHORTLIST_CHANGED } from "@/lib/guest-shortlist";

// Badge counts shared by the customer header and the phone tab bar
// (PRODUCT_PLAN 2.7): one store, one request per refresh however many
// components show the counts. Refreshes on navigation, when the tab regains
// focus, every two minutes while visible, and when a shortlist changes.

export interface CustomerCounts {
  enquiries: number;
  shortlist: number;
}

const ZERO: CustomerCounts = { enquiries: 0, shortlist: 0 };
let state: CustomerCounts = ZERO;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: CustomerCounts) {
  if (next.enquiries === state.enquiries && next.shortlist === state.shortlist) return;
  state = next;
  for (const l of listeners) l();
}

let again = false;

export function refreshCustomerCounts(): Promise<void> {
  // A change during a request (e.g. the guest merge) must not be answered
  // with that older request's numbers: fetch once more when it ends.
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    do {
      again = false;
      try {
        const res = await fetch("/api/my/nav", { cache: "no-store" });
        if (!res.ok) continue;
        const d = (await res.json()) as Partial<CustomerCounts>;
        emit({ enquiries: Number(d.enquiries) || 0, shortlist: Number(d.shortlist) || 0 });
      } catch {
        // Offline: keep the last counts.
      }
    } while (again);
    inflight = null;
  })();
  return inflight;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Live counts; `enabled` false (guests, vendors, admins) skips every request. */
export function useCustomerCounts(enabled: boolean): CustomerCounts {
  const pathname = usePathname();
  const counts = useSyncExternalStore(subscribe, () => state, () => ZERO);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(refreshCustomerCounts, 0);
    return () => clearTimeout(t);
  }, [enabled, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCustomerCounts();
    };
    const onChange = () => refreshCustomerCounts();
    const t = setInterval(onVisible, 120_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(SHORTLIST_CHANGED, onChange);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SHORTLIST_CHANGED, onChange);
    };
  }, [enabled]);

  return enabled ? counts : ZERO;
}
