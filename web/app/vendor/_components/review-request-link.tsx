"use client";

import { useId, useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

// "Request a review" (PRODUCT_PLAN P2-11): a copyable link to the review
// form on the vendor's public profile, plus a WhatsApp share. Customers can
// review once they have sent the vendor an enquiry through Vela.
export default function ReviewRequestLink({
  vendorId,
  vendorName,
  customerName,
  customerPhone,
}: {
  vendorId: number;
  vendorName: string;
  customerName?: string;
  /** E.164 or digits; adds "Send on WhatsApp" to that number. */
  customerPhone?: string | null;
}) {
  const uid = useId();
  const path = `/vendors/${vendorId}#write-review`;
  // window is only known in the browser; the server renders the bare path.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const url = `${origin}${path}`;
  const first = customerName?.split(" ")[0];
  const text = `${first ? `Hi ${first}, ` : "Hi, "}thank you for choosing ${vendorName}! If you have a minute, a short review on Vela would help us a lot: ${url}`;
  const digits = (customerPhone ?? "").replace(/\D/g, "");
  const wa = digits.length >= 10 ? `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(text)}` : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  return (
    <div>
      <label htmlFor={`${uid}-url`} className="label">
        Review link
      </label>
      <div className="flex gap-2">
        <input
          id={`${uid}-url`}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="field min-w-0 flex-1 text-ink-soft"
        />
        <button type="button" onClick={copy} className="btn btn-secondary shrink-0">
          Copy
        </button>
      </div>
      <p aria-live="polite" className="hint">
        {copied === "ok"
          ? "Link copied. Paste it into your chat with the customer."
          : copied === "fail"
            ? "Couldn't copy automatically. Select the link and copy it."
            : "Customers who enquired through Vela can review you from this link."}
      </p>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-block mt-2">
          Send on WhatsApp
        </a>
      )}
    </div>
  );
}
