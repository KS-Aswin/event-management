"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SHORTLIST_CHANGED, clearGuestShortlist, getGuestShortlist } from "@/lib/guest-shortlist";

// After a customer signs in (or signs up), vendors they saved as a guest on
// this device move into their account shortlist (PRODUCT_PLAN P2-9). Mounted
// by the header for customer sessions only. The device list is cleared only
// after the server accepted it, so a failed merge is retried next time.
export default function ShortlistMerge() {
  const router = useRouter();
  const started = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ids = getGuestShortlist();
    if (ids.length === 0) return;
    (async () => {
      try {
        const res = await fetch("/api/my/shortlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendorIds: ids }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { added?: number };
        clearGuestShortlist();
        window.dispatchEvent(new Event(SHORTLIST_CHANGED));
        if (data.added) {
          setNotice(`${data.added} vendor${data.added === 1 ? "" : "s"} you saved earlier ${data.added === 1 ? "is" : "are"} now on your shortlist.`);
          router.refresh();
        }
      } catch {
        // Keep the device list; it merges on the next page load.
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div role="status" aria-live="polite" className={notice ? "" : "sr-only"}>
      {notice && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 z-50 w-max max-w-[calc(100vw-2rem)] bg-foreground text-white text-sm font-medium px-5 py-3 rounded-card shadow-pop">
          {notice}
        </div>
      )}
    </div>
  );
}
