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
}: {
  vendorId: number;
  vendorName: string;
  services?: QuoteService[];
  defaultName?: string;
  loggedIn?: boolean;
  preselectServiceId?: number;
  label?: string;
  variant?: "primary" | "link";
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
    variant === "link"
      ? "text-[13px] text-accent hover:underline font-medium"
      : "px-5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium";

  return (
    <>
      <button type="button" onClick={openDialog} className={triggerClass}>
        {label}
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
          className="p-0 m-0 mt-auto sm:m-auto w-full max-w-none sm:max-w-[420px] max-h-[92dvh] sm:max-h-[90dvh] overflow-auto bg-white text-foreground rounded-t-2xl rounded-b-none sm:rounded-xl backdrop:bg-black/50"
        >
          <div className="p-5 sm:p-7 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 id={titleId} className="text-[19px] font-semibold pt-2">
                Request a quote from {vendorName}
              </h3>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Close"
                className="shrink-0 -mr-2 -mt-1 w-11 h-11 flex items-center justify-center rounded-md text-xl text-ink-soft hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent"
              >
                &times;
              </button>
            </div>

            {success ? (
              <div className="mt-3 space-y-4">
                <div role="status" className="text-sm text-accent bg-accent-tint rounded-md px-3.5 py-3">
                  Quote request sent to {vendorName}.
                </div>
                <div className="text-[13px] text-ink-soft leading-relaxed">
                  <p className="font-medium text-foreground mb-1">What happens next</p>
                  <ul className="list-disc pl-5 space-y-1">
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
                <button
                  type="button"
                  onClick={closeDialog}
                  className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-sm"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3.5 mt-3">
                {error && (
                  <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                    {error}
                  </div>
                )}
                <FormField label="Your name" name="name" required defaultValue={defaultName} autoComplete="name" />
                <FormField label="Phone number" name="phone" type="tel" required autoComplete="tel" />
                <FormField label="Event date" name="eventDate" type="date" required min={minDate} />
                <FormField label="Budget (₹)" name="budget" placeholder="e.g. 1,50,000" />
                {services.length > 0 && (
                  <fieldset>
                    <legend className="block text-[13px] text-ink-soft mb-1.5">
                      Services you&apos;re interested in (optional)
                    </legend>
                    <div className="space-y-1.5">
                      {services.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="serviceIds"
                            value={s.id}
                            defaultChecked={s.id === preselectServiceId}
                            className="accent-[var(--color-accent)]"
                          />
                          {s.title}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                <div>
                  <label htmlFor={`${uid}-message`} className="block text-[13px] text-ink-soft mb-1.5">
                    Message
                  </label>
                  <textarea
                    id={`${uid}-message`}
                    name="message"
                    rows={3}
                    placeholder="Tell them about your event..."
                    className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
                  />
                </div>
                <div className="flex gap-2.5 mt-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-sm disabled:opacity-70"
                  >
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
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  min?: string;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] text-ink-soft mb-1.5">
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
        className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
      />
    </div>
  );
}
