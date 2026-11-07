// Guest shortlist (PRODUCT_PLAN P2-9): signed-out visitors can save vendors
// on this device. The ids live in localStorage and are merged into the
// account by app/_nav/shortlist-merge.tsx right after login or signup.
// Client-only helpers; every storage access is guarded (private windows and
// blocked storage throw).

const KEY = "vela.shortlist.v1";
const EVENT = "vela:guest-shortlist";
/** Same cap as one merge call (lib/shortlist.ts SHORTLIST_LIMITS.mergeBatch). */
export const GUEST_SHORTLIST_MAX = 50;

/** Fired on window whenever any shortlist (guest or account) changes. */
export const SHORTLIST_CHANGED = "vela:shortlist-changed";

let cacheRaw: string | null = null;
let cacheIds: number[] = [];
const EMPTY: number[] = [];

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Saved ids, newest first. Stable array identity while unchanged (for useSyncExternalStore). */
export function getGuestShortlist(): number[] {
  if (typeof window === "undefined") return EMPTY;
  const raw = readRaw();
  if (raw === cacheRaw) return cacheIds;
  cacheRaw = raw;
  let ids: number[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      ids = parsed.filter((n): n is number => Number.isInteger(n) && n > 0 && n <= 2147483647);
    }
  } catch {
    ids = [];
  }
  cacheIds = [...new Set(ids)].slice(0, GUEST_SHORTLIST_MAX);
  return cacheIds;
}

export function getServerGuestShortlist(): number[] {
  return EMPTY;
}

function write(ids: number[]): boolean {
  try {
    if (ids.length) window.localStorage.setItem(KEY, JSON.stringify(ids));
    else window.localStorage.removeItem(KEY);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(EVENT));
  window.dispatchEvent(new Event(SHORTLIST_CHANGED));
  return true;
}

/** Adds or removes one vendor. Returns the new saved state, or null when storage is unavailable or full. */
export function toggleGuestShortlist(vendorId: number): boolean | null {
  const ids = getGuestShortlist();
  if (ids.includes(vendorId)) return write(ids.filter((id) => id !== vendorId)) ? false : null;
  if (ids.length >= GUEST_SHORTLIST_MAX) return null;
  return write([vendorId, ...ids]) ? true : null;
}

export function clearGuestShortlist(): void {
  write([]);
}

export function subscribeGuestShortlist(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}
