"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";

export interface QuoteService {
  id: number;
  title: string;
}

function todayInIST() {
  // en-CA formats as YYYY-MM-DD, which is what <input type="date"> expects.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export default function QuoteButton({
  vendorId,
  vendorName,
  services = [],
  defaultName = "",
  loggedIn = false,
  preselectServiceId,
  label = "Request quote",
  variant = "primary",
  triggerClassName,
}: {
  vendorId: number;
  vendorName: string;
  services?: QuoteService[];
  defaultName?: string;
  loggedIn?: boolean;
  preselectServiceId?: number;
  label?: string;
  variant?: "primary" | "link";
  /** Overrides the trigger's classes (e.g. to stretch it in a sticky bar). */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [minDate, setMinDate] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;

  useEffect(() => {
    if (open && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [open]);

  function openDialog() {
    setMinDate(todayInIST());
    setError(null);
    setSuccess(false);
    setOpen(true);
  }

  function closeDialog() {
    if (dialogRef.current?.open) dialogRef.current.close();
    else setOpen(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const eventDate = String(formData.get("eventDate") ?? "");
    if (eventDate && minDate && eventDate < minDate) {
      setError("Please pick an event date that is today or later.");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(`/api/vendors/${vendorId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          phone: formData.get("phone"),
          eventDate,
          budget: formData.get("budget"),
          message: formData.get("message"),
          serviceIds: formData.getAll("serviceIds").map((v) => Number(v)),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSuccess(true);
      form.reset();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const triggerClass =
    triggerClassName ??
    (variant === "link"
      ? "group inline-flex items-center gap-1 min-h-11 text-sm text-accent font-medium underline-offset-2 hover:underline"
      : "btn btn-primary");

  return (
    <>
      <button type="button" onClick={openDialog} className={triggerClass}>
        {label}
        {variant === "link" ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="w-3.5 h-3.5 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        ) : null}
      </button>

      {open && (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          onClose={() => {
            setOpen(false);
            setSuccess(false);
          }}
          onClick={(e) => {
            // A click on the dialog element itself is a click on the backdrop.
            if (e.target === e.currentTarget) closeDialog();
          }}
          className="p-0 m-0 mt-auto sm:m-auto w-full max-w-none sm:max-w-[480px] max-h-[92dvh] sm:max-h-[90dvh] overflow-auto overscroll-contain bg-white text-foreground rounded-t-2xl rounded-b-none sm:rounded-card shadow-pop backdrop:bg-[rgb(32_33_36/0.55)]"
        >
          <div aria-hidden="true" className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong" />
          <div className="px-5 sm:px-7 pt-3 sm:pt-6">
            <div className="flex items-start justify-between gap-3">
              <h3
                id={titleId}
                className="min-w-0 pt-1.5 font-display text-title sm:text-[20px] font-semibold leading-snug break-words"
              >
                Request a quote from {vendorName}
              </h3>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Close"
                className="shrink-0 -mr-2.5 w-11 h-11 flex items-center justify-center rounded-full text-ink-soft hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {success ? (
              <div className="mt-4 space-y-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-7">
                <div role="status" className="alert-success flex items-start gap-2.5 py-3">
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="w-5 h-5 shrink-0" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Quote request sent to {vendorName}.</span>
                </div>
                <div className="text-sm text-ink-soft leading-relaxed">
                  <p className="font-semibold text-foreground mb-1.5">What happens next</p>
                  <ul className="list-disc pl-5 space-y-1.5 marker:text-line-strong">
                    <li>The vendor will contact you on the phone number you gave.</li>
                    {loggedIn ? (
                      <li>
                        You can see this request in your{" "}
                        <Link href="/dashboard" className="text-accent hover:underline">
                          dashboard
                        </Link>
                        .
                      </li>
                    ) : null}
                  </ul>
                </div>
                <button type="button" onClick={closeDialog} className="btn btn-primary btn-block sm:w-auto sm:px-8">
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4">
                <div className="space-y-4">
                  {error && (
                    <div role="alert" className="alert-error">
                      {error}
                    </div>
                  )}
                  <FormField label="Your name" name="name" required defaultValue={defaultName} autoComplete="name" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Phone number" name="phone" type="tel" required autoComplete="tel" />
                    <FormField label="Event date" name="eventDate" type="date" required min={minDate} />
                  </div>
                  <FormField label="Budget (₹)" name="budget" placeholder="e.g. 1,50,000" inputMode="numeric" />
                  {services.length > 0 && (
                    <fieldset>
                      <legend className="label">Services you&apos;re interested in (optional)</legend>
                      <div className="flex flex-wrap gap-2">
                        {services.map((s) => (
                          <label
                            key={s.id}
                            className="inline-flex items-center gap-2.5 min-h-11 px-3.5 rounded-control border border-line-strong text-sm cursor-pointer hover:bg-surface-muted has-[:checked]:border-accent has-[:checked]:bg-accent-tint has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
                          >
                            <input
                              type="checkbox"
                              name="serviceIds"
                              value={s.id}
                              defaultChecked={s.id === preselectServiceId}
                              className="w-[18px] h-[18px] accent-[var(--color-accent)]"
                            />
                            {s.title}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <div>
                    <label htmlFor={`${uid}-message`} className="label">
                      Message
                    </label>
                    <textarea
                      id={`${uid}-message`}
                      name="message"
                      rows={3}
                      placeholder="Tell them about your event..."
                      className="field resize-y min-h-[96px]"
                    />
                  </div>
                </div>
                <div className="sticky bottom-0 -mx-5 sm:-mx-7 mt-5 px-5 sm:px-7 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 bg-white border-t border-line flex gap-2.5 sm:justify-end">
                  <button type="button" onClick={closeDialog} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button type="submit" disabled={loading} className="btn btn-primary flex-1 sm:flex-none sm:px-6">
                    {loading ? "Sending…" : "Send request"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}

function FormField({
  label,
  name,
  type = "text",
  required,
  placeholder,
  defaultValue,
  min,
  autoComplete,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  min?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        min={min || undefined}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="field"
      />
    </div>
  );
}
