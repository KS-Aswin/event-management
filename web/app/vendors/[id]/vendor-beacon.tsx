"use client";

import { useEffect } from "react";

// Analytics beacon for the public vendor profile (P1-12). Sends one
// profile_view on mount, and a whatsapp_click / phone_click whenever a
// WhatsApp (wa.me / api.whatsapp.com) or tel: link on the page is clicked,
// or any element marked data-vela-track="whatsapp_click" | "phone_click".
// The server (POST /api/events) dedupes views per browser session, ignores
// the owner and admins, and counts only approved vendors. Fire-and-forget:
// failures are silent and never affect the page.

type Kind = "profile_view" | "whatsapp_click" | "phone_click";

// One view per page load per vendor, even if the effect runs twice (Strict
// Mode) before the session cookie from the first beacon is set.
const viewed = new Set<number>();

function send(vendorId: number, kind: Kind) {
  try {
    const body = JSON.stringify({ vendorId, kind });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      if (ok) return;
    }
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    /* analytics must never break the page */
  }
}

function kindOf(el: Element): Kind | null {
  const marked = el.closest("[data-vela-track]");
  const tracked = marked?.getAttribute("data-vela-track");
  if (tracked === "whatsapp_click" || tracked === "phone_click") return tracked;
  // e.g. the "Share on WhatsApp" link after an enquiry: not a click to the vendor.
  if (tracked === "ignore") return null;
  const a = el.closest("a[href]");
  if (!a) return null;
  const href = (a.getAttribute("href") ?? "").toLowerCase();
  if (href.startsWith("tel:")) return "phone_click";
  if (/^(https?:)?\/\/(wa\.me|api\.whatsapp\.com|whatsapp\.com)\//.test(href) || href.startsWith("whatsapp:")) {
    return "whatsapp_click";
  }
  return null;
}

export default function VendorBeacon({ vendorId }: { vendorId: number }) {
  useEffect(() => {
    if (!viewed.has(vendorId)) {
      viewed.add(vendorId);
      send(vendorId, "profile_view");
    }
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      const kind = kindOf(e.target);
      if (kind) send(vendorId, kind);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [vendorId]);
  return null;
}
