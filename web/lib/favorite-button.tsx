"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  SHORTLIST_CHANGED,
  getGuestShortlist,
  getServerGuestShortlist,
  subscribeGuestShortlist,
  toggleGuestShortlist,
} from "@/lib/guest-shortlist";

// Shortlist heart (PRODUCT_PLAN P2-9). Signed-in users save to their account
// (/api/vendors/[id]/favorite); guests save on this device (localStorage),
// merged into the account after login by app/_nav/shortlist-merge.tsx.
export default function FavoriteButton({
  vendorId,
  vendorName,
  initialFavorited,
  loggedIn,
  size = "md",
}: {
  vendorId: number;
  /** Names the vendor in the button's label, so a page of cards (/search) has
   *  distinct button names (QA-102). Optional on a single-vendor page. */
  vendorName?: string;
  initialFavorited: boolean;
  loggedIn: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialFavorited);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const guestIds = useSyncExternalStore(subscribeGuestShortlist, getGuestShortlist, getServerGuestShortlist);
  const favorited = loggedIn ? saved : guestIds.includes(vendorId);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault(); // don't follow a parent <Link> (used on vendor cards)
    e.stopPropagation();

    if (!loggedIn) {
      const now = toggleGuestShortlist(vendorId);
      if (now === null) setMessage({ text: "Couldn't save on this device", error: true });
      else if (now) setMessage({ text: "Saved on this device. Sign in to keep it", error: false });
      else setMessage(null);
      return;
    }

    const next = !saved;
    setSaved(next); // optimistic
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/vendors/${vendorId}/favorite`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        setSaved(!next); // roll back
        setMessage({ text: res.status === 401 ? "Please sign in again" : "Couldn't save, try again", error: true });
        return;
      }
      window.dispatchEvent(new Event(SHORTLIST_CHANGED));
      router.refresh();
    } catch {
      setSaved(!next); // roll back
      setMessage({ text: "Couldn't save, try again", error: true });
    } finally {
      setLoading(false);
    }
  }

  const dim = size === "sm" ? 18 : 22;

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-pressed={favorited}
        aria-label={
          vendorName
            ? favorited
              ? `Remove ${vendorName} from shortlist`
              : `Save ${vendorName} to shortlist`
            : favorited
              ? "Remove from shortlist"
              : "Save to shortlist"
        }
        className="group shrink-0 -m-3 w-11 h-11 inline-flex items-center justify-center rounded-full hover:bg-surface-muted active:bg-line disabled:opacity-60 transition-colors"
      >
        <svg
          width={dim}
          height={dim}
          viewBox="0 0 24 24"
          fill={favorited ? "#c9a227" : "none"}
          stroke={favorited ? "#c9a227" : "currentColor"}
          strokeWidth="1.8"
          className={`transition-transform duration-150 motion-safe:group-active:scale-90 ${
            favorited ? "" : "text-ink-soft group-hover:text-foreground"
          }`}
          aria-hidden="true"
        >
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
        </svg>
      </button>
      <span
        role="status"
        aria-live="polite"
        className={
          message
            ? `absolute top-full right-0 mt-1 z-10 whitespace-nowrap text-xs bg-white border rounded-md px-2 py-1 shadow-pop ${
                message.error ? "text-danger border-danger-tint" : "text-foreground border-line"
              }`
            : "sr-only"
        }
      >
        {message?.text ?? ""}
      </span>
    </span>
  );
}
