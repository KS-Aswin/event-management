"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { trapTabKey } from "@/app/_components/focus-trap";

// Quote dialog v2 (P2-2): event type, date, time of day, guests, district,
// venue type, food preference (caterers), budget band, the offerings asked
// for with a quantity for per-unit prices (min-qty warning, still allowed),
// phone with country code, email and preferred contact. After sending it
// shows the tracking link and a WhatsApp share text that includes it.

export interface QuoteService {
  id: number;
  title: string;
  kind?: "unit" | "package";
  priceUnit?: string;
  unitLabel?: string | null;
  minQty?: number | null;
}

export interface QuoteOption {
  id: number;
  name: string;
}

// Price units where the customer can say how many (mirrors lib/enquiries-create QTY_UNITS).
const QTY_UNITS = new Set([
  "plate", "person", "hour", "day", "slot", "artist", "item", "set", "kg", "sqft", "km", "vehicle", "session", "piece",
]);
const UNIT_NOUN: Record<string, [string, string]> = {
  plate: ["plate", "plates"],
  person: ["person", "people"],
  hour: ["hour", "hours"],
  day: ["day", "days"],
  slot: ["slot", "slots"],
  artist: ["artist", "artists"],
  item: ["item", "items"],
  set: ["set", "sets"],
  kg: ["kg", "kg"],
  sqft: ["sq ft", "sq ft"],
  km: ["km", "km"],
  vehicle: ["vehicle", "vehicles"],
  session: ["session", "sessions"],
  piece: ["piece", "pieces"],
};
const PER_GUEST = new Set(["plate", "person"]);

const BUDGETS: { value: string; label: string }[] = [
  { value: "", label: "Not sure yet" },
  { value: "0-50000", label: "Under ₹50,000" },
  { value: "50000-100000", label: "₹50,000 – ₹1 lakh" },
  { value: "100000-300000", label: "₹1 – 3 lakh" },
  { value: "300000-500000", label: "₹3 – 5 lakh" },
  { value: "500000-1000000", label: "₹5 – 10 lakh" },
  { value: "1000000-", label: "Above ₹10 lakh" },
];

const VENUES: [string, string][] = [
  ["hall", "Auditorium / hall"],
  ["home", "Home"],
  ["outdoor", "Outdoor"],
  ["temple", "Temple"],
  ["church", "Church"],
  ["mosque", "Mosque"],
  ["office", "Office"],
  ["other", "Other"],
];

function todayInIST() {
  // en-CA formats as YYYY-MM-DD, which is what <input type="date"> expects.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function noun(s: QuoteService, n: number) {
  if (s.unitLabel) return s.unitLabel;
  const pair = UNIT_NOUN[s.priceUnit ?? ""];
  return pair ? pair[n === 1 ? 0 : 1] : "";
}

type Warning = { code: string; message: string };
type Sent = { trackingPath: string; guest: boolean; warnings: Warning[]; email: string | null };

export default function QuoteButton({
  vendorId,
  vendorName,
  services = [],
  defaultName = "",
  defaultPhone = "",
  defaultEmail = "",
  loggedIn = false,
  preselectServiceId,
  eventTypes = [],
  districts = [],
  showFood = false,
  label = "Request quote",
  variant = "primary",
  triggerClassName,
}: {
  vendorId: number;
  vendorName: string;
  services?: QuoteService[];
  defaultName?: string;
  defaultPhone?: string;
  defaultEmail?: string;
  loggedIn?: boolean;
  preselectServiceId?: number;
  eventTypes?: QuoteOption[];
  districts?: QuoteOption[];
  /** Ask veg / non-veg (caterers). */
  showFood?: boolean;
  label?: string;
  variant?: "primary" | "link";
  /** Overrides the trigger's classes (e.g. to stretch it in a sticky bar). */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [minDate, setMinDate] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [qty, setQty] = useState<Record<number, string>>({});
  const [guests, setGuests] = useState("");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;

  useEffect(() => {
    if (open && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [open]);

  function openDialog() {
    setMinDate(todayInIST());
    setOrigin(window.location.origin);
    setError(null);
    setErrorField(null);
    setSent(null);
    setCopied(false);
    setSelected(new Set(preselectServiceId && services.some((s) => s.id === preselectServiceId) ? [preselectServiceId] : []));
    setQty({});
    setGuests("");
    setOpen(true);
  }

  function closeDialog() {
    if (dialogRef.current?.open) dialogRef.current.close();
    else setOpen(false);
  }

  function toggle(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function showError(message: string, field: string | null) {
    setError(message);
    setErrorField(field);
    requestAnimationFrame(() => {
      const el = field ? formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`) : null;
      if (el) el.focus();
      else formRef.current?.querySelector<HTMLElement>("[role=alert]")?.scrollIntoView({ block: "center" });
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setErrorField(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const str = (k: string) => String(fd.get(k) ?? "").trim();
    const eventDate = str("eventDate");
    if (eventDate && minDate && eventDate < minDate) {
      showError("Please pick an event date that is today or later.", "eventDate");
      return;
    }
    const [bMin, bMax] = str("budgetBand").split("-");
    const units = services
      .filter((s) => selected.has(s.id))
      .map((s) => {
        const q = qty[s.id];
        return q && Number(q) > 0 ? { serviceId: s.id, qty: Number(q) } : { serviceId: s.id };
      });
    setLoading(true);
    try {
      const res = await fetch(`/api/vendors/${vendorId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: str("name"),
          phone: str("phone"),
          contactEmail: str("contactEmail") || null,
          preferredContact: str("preferredContact") || "whatsapp",
          eventDate: eventDate || null,
          eventTypeId: str("eventTypeId") ? Number(str("eventTypeId")) : null,
          slot: str("slot") || null,
          guestCount: str("guestCount") ? Number(str("guestCount")) : null,
          districtId: str("districtId") ? Number(str("districtId")) : null,
          venueType: str("venueType") || null,
          foodPref: str("foodPref") || null,
          budgetMin: bMin ? Number(bMin) : null,
          budgetMax: bMax ? Number(bMax) : null,
          message: str("message") || null,
          units,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const field = typeof data.field === "string" ? (data.field === "budget" ? "budgetBand" : data.field) : null;
        showError(data.error ?? "Something went wrong. Please try again.", field);
        return;
      }
      setSent({
        trackingPath: data.enquiry?.trackingPath ?? "/my/enquiries",
        guest: !!data.enquiry?.guestToken,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        email: str("contactEmail") || null,
      });
      form.reset();
    } catch {
      showError("Could not reach the server. Please try again.", null);
    } finally {
      setLoading(false);
    }
  }

  const triggerClass =
    triggerClassName ??
    (variant === "link"
      ? "group inline-flex items-center gap-1 min-h-11 text-sm text-accent font-medium underline-offset-2 hover:underline"
      : "btn btn-primary");

  const guestN = Number(guests) || null;
  const trackingUrl = sent ? `${origin}${sent.trackingPath}` : "";
  const shareText = sent ? `I've sent an enquiry to ${vendorName} on Vela. Track it here: ${trackingUrl}` : "";
  const invalid = (f: string) => (errorField === f ? true : undefined);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

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
          // Tab wraps inside the dialog instead of leaving for the browser chrome (QA-016).
          onKeyDown={trapTabKey}
          onClose={() => {
            setOpen(false);
            setSent(null);
          }}
          onClick={(e) => {
            // A click on the dialog element itself is a click on the backdrop.
            if (e.target === e.currentTarget) closeDialog();
          }}
          className="p-0 m-0 mt-auto sm:m-auto w-full max-w-none sm:max-w-[560px] max-h-[92dvh] sm:max-h-[90dvh] overflow-auto overscroll-contain bg-white text-foreground rounded-t-2xl rounded-b-none sm:rounded-card shadow-pop backdrop:bg-[rgb(32_33_36/0.55)]"
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
                <svg aria-hidden="true" viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {sent ? (
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

                {sent.warnings.length ? (
                  <ul className="rounded-control border border-[#ecd98f] bg-[#fbf3d9] px-3.5 py-2.5 text-sm text-gold-ink space-y-1">
                    {sent.warnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                ) : null}

                <div className="rounded-card border border-line p-4">
                  <p className="text-sm font-semibold">{sent.guest ? "Track your enquiry" : "Follow this enquiry"}</p>
                  <p className="text-caption text-ink-soft mt-0.5">
                    {sent.guest
                      ? "Save this link: it shows the vendor's offers and replies. Keep it private."
                      : "Offers and replies appear in My enquiries."}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <label htmlFor={`${uid}-track`} className="sr-only">
                      Tracking link
                    </label>
                    <input
                      id={`${uid}-track`}
                      readOnly
                      value={trackingUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="field min-w-0 flex-1 text-ink-soft"
                    />
                    <button type="button" onClick={copyLink} className="btn btn-secondary shrink-0" aria-live="polite">
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="mt-2.5 flex flex-col sm:flex-row gap-2.5">
                    <Link href={sent.trackingPath} className="btn btn-primary">
                      {sent.guest ? "Open tracking page" : "View my enquiries"}
                    </Link>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-vela-track="ignore"
                      className="btn btn-secondary"
                    >
                      Share on WhatsApp
                    </a>
                  </div>
                </div>

                <div className="text-sm text-ink-soft leading-relaxed">
                  <p className="font-semibold text-foreground mb-1.5">What happens next</p>
                  <ul className="list-disc pl-5 space-y-1.5 marker:text-line-strong">
                    <li>{vendorName} gets your request now and replies on your preferred channel.</li>
                    <li>Priced offers and messages show up on the {sent.guest ? "tracking page" : "enquiry page"}.</li>
                    {sent.guest ? (
                      <li>
                        <Link href={`/signup?next=${encodeURIComponent("/my/enquiries")}`} className="text-accent hover:underline">
                          Create a free account
                        </Link>{" "}
                        {sent.email ? `with ${sent.email} ` : "with the same email "}to reply and accept offers in one place.
                      </li>
                    ) : null}
                  </ul>
                </div>
                <button type="button" onClick={closeDialog} className="btn btn-primary btn-block sm:w-auto sm:px-8">
                  Done
                </button>
              </div>
            ) : (
              <form ref={formRef} onSubmit={handleSubmit} className="mt-4">
                <div className="space-y-5">
                  {error && (
                    <div role="alert" className="alert-error">
                      {error}
                    </div>
                  )}

                  {services.length > 0 && (
                    <fieldset>
                      <legend className="label">What do you need? (optional)</legend>
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
                              checked={selected.has(s.id)}
                              onChange={(e) => toggle(s.id, e.currentTarget.checked)}
                              className="w-[18px] h-[18px] accent-[var(--color-accent)]"
                            />
                            {s.title}
                          </label>
                        ))}
                      </div>
                      {services
                        .filter((s) => selected.has(s.id) && s.kind !== "package" && QTY_UNITS.has(s.priceUnit ?? ""))
                        .map((s) => {
                          const typed = Number(qty[s.id]) || null;
                          const effective = typed ?? (PER_GUEST.has(s.priceUnit ?? "") ? guestN : null);
                          const below = s.minQty != null && effective != null && effective < s.minQty;
                          const hintId = `${uid}-qty-${s.id}-hint`;
                          return (
                            <div key={s.id} className="mt-3">
                              <label htmlFor={`${uid}-qty-${s.id}`} className="label">
                                {s.title}: how many {noun(s, 2)}?
                              </label>
                              <input
                                id={`${uid}-qty-${s.id}`}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                step="any"
                                value={qty[s.id] ?? ""}
                                onChange={(e) => {
                                  const v = e.currentTarget.value;
                                  setQty((q) => ({ ...q, [s.id]: v }));
                                }}
                                placeholder={PER_GUEST.has(s.priceUnit ?? "") ? "Same as guests" : s.minQty ? `e.g. ${s.minQty}` : ""}
                                aria-describedby={hintId}
                                className="field sm:max-w-[220px]"
                              />
                              <p id={hintId} className={below ? "hint text-gold-ink" : "hint"} aria-live="polite">
                                {below
                                  ? `${vendorName} usually takes at least ${s.minQty} ${noun(s, s.minQty ?? 2)}. You can still send this.`
                                  : s.minQty
                                    ? `Minimum ${s.minQty} ${noun(s, s.minQty)}.`
                                    : "Leave empty if you're not sure."}
                              </p>
                            </div>
                          );
                        })}
                    </fieldset>
                  )}

                  <fieldset className="space-y-4">
                    <legend className="eyebrow mb-3">Your event</legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Select label="Event type" name="eventTypeId" invalid={invalid("eventTypeId")}>
                        <option value="">Choose…</option>
                        {eventTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                      <FormField label="Event date" name="eventDate" type="date" required min={minDate} invalid={invalid("eventDate")} />
                      <Select label="Time of day" name="slot" invalid={invalid("slot")}>
                        <option value="">Not sure</option>
                        <option value="full">Full day</option>
                        <option value="morning">Morning</option>
                        <option value="evening">Evening</option>
                      </Select>
                      <div>
                        <label htmlFor={`${uid}-guests`} className="label">
                          Guests
                        </label>
                        <input
                          id={`${uid}-guests`}
                          name="guestCount"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={100000}
                          step={1}
                          value={guests}
                          onChange={(e) => setGuests(e.currentTarget.value)}
                          placeholder="e.g. 300"
                          aria-invalid={invalid("guestCount")}
                          className="field"
                        />
                      </div>
                      <Select label="District" name="districtId" invalid={invalid("districtId")}>
                        <option value="">Choose…</option>
                        {districts.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                      <Select label="Venue type" name="venueType" invalid={invalid("venueType")}>
                        <option value="">Not decided</option>
                        {VENUES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </Select>
                      {showFood ? (
                        <Select label="Food preference" name="foodPref" invalid={invalid("foodPref")}>
                          <option value="">Not sure</option>
                          <option value="veg">Vegetarian</option>
                          <option value="non_veg">Non-vegetarian</option>
                          <option value="both">Veg and non-veg</option>
                        </Select>
                      ) : null}
                      <Select label="Budget" name="budgetBand" invalid={invalid("budgetBand")}>
                        {BUDGETS.map((b) => (
                          <option key={b.value} value={b.value}>
                            {b.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="eyebrow mb-3">How to reach you</legend>
                    <FormField label="Your name" name="name" required defaultValue={defaultName} autoComplete="name" invalid={invalid("name")} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        label="Phone number"
                        name="phone"
                        type="tel"
                        required
                        autoComplete="tel"
                        defaultValue={defaultPhone}
                        hint="Indian mobile, or with country code (+971…)"
                        invalid={invalid("phone")}
                      />
                      <FormField
                        label={loggedIn ? "Email" : "Email (recommended)"}
                        name="contactEmail"
                        type="email"
                        autoComplete="email"
                        defaultValue={defaultEmail}
                        hint={loggedIn ? undefined : "Use it to sign up later and keep this enquiry"}
                        invalid={invalid("contactEmail")}
                      />
                    </div>
                    <fieldset>
                      <legend className="label">Preferred contact</legend>
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            ["whatsapp", "WhatsApp"],
                            ["call", "Phone call"],
                            ["email", "Email"],
                          ] as const
                        ).map(([v, l]) => (
                          <label
                            key={v}
                            className="inline-flex items-center gap-2.5 min-h-11 px-3.5 rounded-control border border-line-strong text-sm cursor-pointer hover:bg-surface-muted has-[:checked]:border-accent has-[:checked]:bg-accent-tint has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
                          >
                            <input
                              type="radio"
                              name="preferredContact"
                              value={v}
                              defaultChecked={v === "whatsapp"}
                              className="w-[18px] h-[18px] accent-[var(--color-accent)]"
                            />
                            {l}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </fieldset>

                  <div>
                    <label htmlFor={`${uid}-message`} className="label">
                      Message
                    </label>
                    <textarea
                      id={`${uid}-message`}
                      name="message"
                      rows={3}
                      maxLength={1000}
                      placeholder="Anything else the vendor should know: theme, timings, special requests…"
                      aria-invalid={invalid("message")}
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

function Select({
  label,
  name,
  invalid,
  children,
}: {
  label: string;
  name: string;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} name={name} aria-invalid={invalid} className="field" defaultValue="">
        {children}
      </select>
    </div>
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
  hint,
  invalid,
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
  hint?: string;
  invalid?: boolean;
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
        aria-invalid={invalid}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="field"
      />
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
