"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { patchLead } from "./lead-status-control";

// Call / WhatsApp links for a lead. Tapping one never changes the status by
// itself (a call doesn't mean the vendor replied); for a new lead it offers an
// optional "Mark as replied" button afterwards.
export function LeadContact({
  leadId,
  phone,
  telHref,
  waHref,
  email,
  isPending,
  size = "sm",
}: {
  leadId: number;
  phone: string;
  telHref: string;
  waHref: string | null;
  email?: string | null;
  isPending: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [contacted, setContacted] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const btn = size === "sm" ? "btn btn-secondary btn-sm" : "btn btn-secondary";

  async function markReplied() {
    setState("saving");
    setError(null);
    const err = await patchLead(leadId, { status: "responded" });
    if (err) {
      setError(err);
      setState("idle");
      return;
    }
    setState("done");
    router.refresh();
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {waHref && (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setContacted(true)}
            className={`${size === "sm" ? "btn btn-primary btn-sm" : "btn btn-primary"}`}
          >
            <WhatsAppIcon />
            WhatsApp
          </a>
        )}
        <a href={telHref} onClick={() => setContacted(true)} className={btn}>
          <PhoneIcon />
          Call <span className="tabular-nums">{phone}</span>
        </a>
        {email && (
          <a href={`mailto:${email}`} onClick={() => setContacted(true)} className={btn}>
            Email
          </a>
        )}
        {isPending && contacted && state !== "done" && (
          <button type="button" onClick={markReplied} disabled={state === "saving"} className={btn}>
            {state === "saving" ? "Saving…" : "Mark as replied"}
          </button>
        )}
      </div>
      <div aria-live="polite" className="text-[11.5px]">
        {error && <span className="text-danger">{error}</span>}
      </div>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
    </svg>
  );
}

// Customer message, clamped to a few lines with a Show more toggle when long.
export function LeadMessage({ message, clamp = true }: { message: string; clamp?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = clamp && (message.length > 160 || message.split("\n").length > 3);
  return (
    <div className="mt-1">
      <p className={`whitespace-pre-line text-[13.5px] text-foreground ${!open && long ? "line-clamp-3" : ""}`}>
        &ldquo;{message}&rdquo;
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center min-h-11 sm:min-h-8 text-xs font-medium text-accent hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
