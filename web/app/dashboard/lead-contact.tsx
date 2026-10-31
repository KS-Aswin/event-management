"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { patchQuoteStatus } from "./lead-status-control";

// Call / WhatsApp links for a lead. Tapping one never changes the status by
// itself (a call doesn't mean the vendor replied); for a new lead it offers an
// optional "Mark as replied" button afterwards.
export function LeadContact({
  quoteId,
  phone,
  telHref,
  waHref,
  isPending,
}: {
  quoteId: number;
  phone: string;
  telHref: string;
  waHref: string | null;
  isPending: boolean;
}) {
  const router = useRouter();
  const [contacted, setContacted] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const linkClass =
    "inline-flex items-center justify-center min-h-11 px-3 rounded-md border border-line text-[13px] font-medium hover:border-accent hover:text-accent";

  async function markReplied() {
    setState("saving");
    setError(null);
    const err = await patchQuoteStatus(quoteId, "responded");
    if (err) {
      setError(err);
      setState("idle");
      return;
    }
    setState("done");
    router.refresh();
  }

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <a href={telHref} onClick={() => setContacted(true)} className={linkClass}>
          Call {phone}
        </a>
        {waHref && (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setContacted(true)}
            className={linkClass}
          >
            WhatsApp
          </a>
        )}
        {isPending && contacted && state !== "done" && (
          <button
            type="button"
            onClick={markReplied}
            disabled={state === "saving"}
            className="min-h-11 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium disabled:opacity-70"
          >
            {state === "saving" ? "Saving…" : "Mark as replied"}
          </button>
        )}
      </div>
      <div aria-live="polite" className="text-[11.5px]">
        {error && <span className="text-red-700">{error}</span>}
      </div>
    </div>
  );
}

// Customer message, clamped to a few lines with a Show more toggle when long.
export function LeadMessage({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  const long = message.length > 160 || message.split("\n").length > 3;
  return (
    <div className="mt-1">
      <p className={`whitespace-pre-line text-[13px] text-foreground ${!open && long ? "line-clamp-3" : ""}`}>
        &ldquo;{message}&rdquo;
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-xs text-accent hover:underline mt-0.5"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
