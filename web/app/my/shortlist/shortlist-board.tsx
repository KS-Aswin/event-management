"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import CardImage from "@/app/search/card-image";
import type { EnquiryDefaults, ShortlistItem } from "@/lib/shortlist";
import { SHORTLIST_CHANGED } from "@/lib/guest-shortlist";

export type BoardItem = ShortlistItem & { image: string | null; color: string | null; enquiryId: number | null };

const MAX_SEND = 5;
const MAX_COMPARE = 4;
const NOTE_MAX = 500;

const BUDGETS: { value: string; label: string }[] = [
  { value: "", label: "Not sure yet" },
  { value: "0-50000", label: "Under ₹50,000" },
  { value: "50000-100000", label: "₹50,000 – ₹1 lakh" },
  { value: "100000-300000", label: "₹1 – 3 lakh" },
  { value: "300000-500000", label: "₹3 – 5 lakh" },
  { value: "500000-1000000", label: "₹5 – 10 lakh" },
  { value: "1000000-", label: "Above ₹10 lakh" },
];

/** The budget preset matching a saved min/max, else "" (Not sure yet). */
function budgetPreset(min: number | null, max: number | null): string {
  if (min === null && max === null) return "";
  const v = `${min ?? 0}-${max ?? ""}`;
  return BUDGETS.some((b) => b.value === v) ? v : "";
}

function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export default function ShortlistBoard({
  items: initial,
  categoryOrder,
  categoryLabels,
  eventTypes,
  districts,
  defaults,
}: {
  items: BoardItem[];
  categoryOrder: string[];
  /** Internal category name -> display name (admin renames, QA-008). */
  categoryLabels: Record<string, string>;
  eventTypes: { id: number; name: string }[];
  districts: { id: number; name: string }[];
  defaults: EnquiryDefaults;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState<number[]>([]);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  // Server refreshes (router.refresh after a send) replace the list.
  const [lastInitial, setLastInitial] = useState(initial);
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setItems(initial);
    setSelected((s) => s.filter((id) => initial.some((i) => i.vendorId === id && i.available)));
  }

  const groups = useMemo(() => {
    const byCat = new Map<string, BoardItem[]>();
    for (const i of items) {
      const list = byCat.get(i.category) ?? [];
      list.push(i);
      byCat.set(i.category, list);
    }
    const rank = (c: string) => {
      const n = categoryOrder.indexOf(c);
      return n === -1 ? Number.MAX_SAFE_INTEGER : n;
    };
    return [...byCat.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }, [items, categoryOrder]);

  function toggle(id: number) {
    setLimitMsg(null);
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= MAX_SEND) {
        setLimitMsg(`You can send one enquiry to at most ${MAX_SEND} vendors at a time.`);
        return s;
      }
      return [...s, id];
    });
  }

  async function remove(id: number) {
    const before = items;
    setItems((list) => list.filter((i) => i.vendorId !== id));
    setSelected((s) => s.filter((x) => x !== id));
    try {
      const res = await fetch(`/api/my/shortlist?vendorId=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      window.dispatchEvent(new Event(SHORTLIST_CHANGED));
    } catch {
      setItems(before);
      setLimitMsg("Couldn't remove that vendor. Check your connection and try again.");
    }
  }

  function noteSaved(id: number, note: string | null) {
    setItems((list) => list.map((i) => (i.vendorId === id ? { ...i, note } : i)));
  }

  const selectedItems = items.filter((i) => selected.includes(i.vendorId));
  const canCompare = selected.length >= 2 && selected.length <= MAX_COMPARE;

  if (items.length === 0) {
    return (
      <section className="card py-10 text-center max-w-[52ch] mx-auto">
        <h2 className="text-title font-semibold">Your shortlist is empty</h2>
        <p className="text-body text-ink-soft mt-1">
          Tap the heart on any vendor to save them here. You can add notes, compare up to 4 side by side and send one enquiry to
          up to 5 at once.
        </p>
        <Link href="/search" className="btn btn-primary mt-4">
          Find vendors
        </Link>
      </section>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        {groups.map(([category, list]) => (
          <section key={category} aria-labelledby={`cat-${slug(category)}`}>
            <h2 id={`cat-${slug(category)}`} className="eyebrow mb-2">
              {categoryLabels[category] ?? category} · {list.length}
            </h2>
            <ul className="card p-0 divide-y divide-line">
              {list.map((i) => (
                <ShortlistRow
                  key={i.vendorId}
                  item={i}
                  checked={selected.includes(i.vendorId)}
                  onToggle={() => toggle(i.vendorId)}
                  onRemove={() => remove(i.vendorId)}
                  onNoteSaved={(n) => noteSaved(i.vendorId, n)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* Selection bar: sits above the phone tab bar, at the bottom on desktop. */}
      <div
        className={`sticky z-20 mt-6 bottom-[calc(65px+env(safe-area-inset-bottom))] lg:bottom-4 ${selected.length || limitMsg ? "" : "hidden"}`}
      >
        <div className="card shadow-pop flex flex-col sm:flex-row sm:items-center gap-3 p-3 sm:p-4" role="region" aria-label="Selected vendors">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold" aria-live="polite">
              {selected.length} of {MAX_SEND} selected
            </p>
            {limitMsg ? (
              <p role="alert" className="text-caption text-danger mt-0.5">
                {limitMsg}
              </p>
            ) : (
              <p className="text-caption text-ink-soft mt-0.5">
                {selected.length > MAX_COMPARE ? `Compare works with up to ${MAX_COMPARE} vendors.` : canCompare ? "Ready to compare or enquire." : "Select one more to compare."}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {canCompare ? (
              <Link href={`/my/compare?ids=${selected.join(",")}`} className="btn btn-secondary flex-1 sm:flex-none">
                Compare
              </Link>
            ) : (
              <button type="button" className="btn btn-secondary flex-1 sm:flex-none" disabled aria-disabled="true">
                Compare
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary flex-1 sm:flex-none"
              disabled={selected.length === 0}
              onClick={() => setSendOpen(true)}
            >
              Send enquiry{selected.length > 1 ? ` to ${selected.length}` : ""}
            </button>
          </div>
        </div>
      </div>

      {sendOpen && (
        <SendDialog
          vendors={selectedItems}
          eventTypes={eventTypes}
          districts={districts}
          defaults={defaults}
          onClose={(sent) => {
            setSendOpen(false);
            if (sent) {
              setSelected([]);
              router.refresh();
            }
          }}
        />
      )}
    </>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function ShortlistRow({
  item: i,
  checked,
  onToggle,
  onRemove,
  onNoteSaved,
}: {
  item: BoardItem;
  checked: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onNoteSaved: (note: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const checkId = useId();
  return (
    <li className={`px-4 py-3.5 sm:px-5 ${checked ? "bg-accent-tint/50" : ""}`} data-testid="shortlist-row">
      <div className="flex items-start gap-3">
        <label
          htmlFor={checkId}
          className={`-m-2.5 p-2.5 shrink-0 inline-flex items-center justify-center min-w-11 min-h-11 ${i.available ? "cursor-pointer" : "opacity-40"}`}
        >
          <input
            id={checkId}
            type="checkbox"
            checked={checked}
            disabled={!i.available}
            onChange={onToggle}
            className="size-5 accent-[var(--color-accent)]"
          />
          <span className="sr-only">Select {i.name}</span>
        </label>
        <CardImage src={i.image} color={i.color} category={i.category} className="w-14 h-14 sm:w-16 sm:h-16 rounded-control! shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-snug">
                {i.available ? (
                  <Link href={`/vendors/${i.vendorId}`} className="inline-block py-2.5 -my-2.5 hover:underline underline-offset-2 hover:text-accent">
                    {i.name}
                  </Link>
                ) : (
                  <span className="text-ink-soft">{i.name}</span>
                )}
                {i.verified && (
                  <span className="ml-1.5 align-middle chip bg-accent-tint text-accent-hover text-[11px]">Verified</span>
                )}
              </h3>
              <p className="text-caption text-ink-soft mt-0.5">
                {i.location}
                {i.reviewsCount > 0 ? (
                  <>
                    {" · "}
                    <span className="text-gold" aria-hidden="true">★</span> {i.rating.toFixed(1)} ({i.reviewsCount})
                  </>
                ) : (
                  " · New"
                )}
              </p>
              {i.available && (
                <p className="text-[13px] font-semibold text-accent tabular-nums mt-0.5">{i.priceLabel ?? "Price on request"}</p>
              )}
              {!i.available && <p className="text-caption text-danger mt-0.5">No longer available on Vela</p>}
              {i.enquiryId && (
                <Link href={`/my/enquiries/${i.enquiryId}`} className="inline-flex items-center min-h-11 -my-1.5 text-caption font-medium text-accent hover:underline underline-offset-2">
                  Enquiry sent · view
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${i.name} from shortlist`}
              className="-mr-2 -mt-1.5 shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-full text-ink-soft hover:bg-surface-muted hover:text-danger transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          </div>

          {editing ? (
            <NoteEditor
              vendorId={i.vendorId}
              vendorName={i.name}
              initial={i.note ?? ""}
              onDone={(saved) => {
                setEditing(false);
                if (saved !== undefined) onNoteSaved(saved);
              }}
            />
          ) : i.note ? (
            <div className="mt-2 rounded-control bg-surface-muted px-3 py-2">
              <p className="text-body whitespace-pre-line break-words">{i.note}</p>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center min-h-11 -mb-2 text-sm font-medium text-accent hover:underline underline-offset-2"
              >
                Edit note<span className="sr-only"> for {i.name}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-1 -mb-2 inline-flex items-center min-h-11 text-sm font-medium text-accent hover:underline underline-offset-2"
            >
              + Add note<span className="sr-only"> for {i.name}</span>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function NoteEditor({
  vendorId,
  vendorName,
  initial,
  onDone,
}: {
  vendorId: number;
  vendorName: string;
  initial: string;
  onDone: (saved?: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/my/shortlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId, note: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { note?: string | null; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Couldn't save the note. Try again.");
        return;
      }
      onDone(data.note ?? null);
    } catch {
      setError("Couldn't save the note. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-2">
      <label htmlFor={id} className="sr-only">
        Note for {vendorName}
      </label>
      <textarea
        id={id}
        ref={ref}
        value={value}
        maxLength={NOTE_MAX}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
        placeholder="e.g. Asked about the Sunday rate; cousin recommended them"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-count`}
        className="field min-h-[84px]!"
      />
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span id={`${id}-count`} className="text-caption text-ink-soft tabular-nums">
          {value.length}/{NOTE_MAX}
        </span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDone()}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-caption text-danger mt-1">
          {error}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Send one enquiry to the selected vendors (POST /api/enquiries/multi)
// ---------------------------------------------------------------------------

type Result =
  | { vendorId: number; ok: true; enquiryId: number; warnings?: { code: string; message?: string }[] }
  | { vendorId: number; ok: false; code: string; error: string };

function SendDialog({
  vendors,
  eventTypes,
  districts,
  defaults,
  onClose,
}: {
  vendors: BoardItem[];
  eventTypes: { id: number; name: string }[];
  districts: { id: number; name: string }[];
  defaults: EnquiryDefaults;
  onClose: (sent: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const f = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [today] = useState(todayInIndia);
  const names = new Map(vendors.map((v) => [v.vendorId, v.name]));
  // Prefill (QA-029): only values the controls can show; a date already past
  // (the sheet stayed open over midnight) or a retired option starts blank.
  const pre = {
    eventDate: defaults.eventDate && defaults.eventDate >= today ? defaults.eventDate : "",
    eventTypeId: eventTypes.some((t) => t.id === defaults.eventTypeId) ? String(defaults.eventTypeId) : "",
    districtId: districts.some((d) => d.id === defaults.districtId) ? String(defaults.districtId) : "",
    guestCount: defaults.guestCount ? String(defaults.guestCount) : "",
    budget: budgetPreset(defaults.budgetMin, defaults.budgetMax),
  };
  const prefilled = !!(pre.eventDate || pre.eventTypeId || pre.districtId || pre.guestCount);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  function close() {
    ref.current?.close();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const [bMin, bMax] = get("budget").split("-");
    const body = {
      vendorIds: vendors.map((v) => v.vendorId),
      name: get("name"),
      phone: get("phone"),
      eventDate: get("eventDate") || null,
      eventTypeId: get("eventTypeId") ? Number(get("eventTypeId")) : null,
      districtId: get("districtId") ? Number(get("districtId")) : null,
      guestCount: get("guestCount") ? Number(get("guestCount")) : null,
      budgetMin: bMin ? Number(bMin) : null,
      budgetMax: bMax ? Number(bMax) : null,
      preferredContact: get("preferredContact") || "whatsapp",
      message: get("message") || null,
    };
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/enquiries/multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string; results?: Result[] };
      if (res.status === 201 || (res.status === 409 && data.results)) {
        setResults(data.results ?? []);
        return;
      }
      setError({ text: data.error ?? "Couldn't send the enquiry. Please try again.", field: data.field });
      if (data.field) {
        const el = document.getElementById(`${f}-${data.field}`);
        el?.focus();
      }
    } catch {
      setError({ text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const sentCount = results?.filter((r) => r.ok).length ?? 0;
  const fieldError = (name: string) => (error?.field === name ? error.text : null);
  const inv = (name: string) => (error?.field === name ? true : undefined);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => onClose(sentCount > 0)}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="p-0 m-0 mt-auto sm:m-auto w-full max-w-none sm:max-w-[560px] max-h-[92dvh] sm:max-h-[90dvh] overflow-auto overscroll-contain bg-white text-foreground rounded-t-2xl rounded-b-none sm:rounded-card shadow-pop backdrop:bg-[rgb(32_33_36/0.55)]"
    >
      <div aria-hidden="true" className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong" />
      <div className="px-5 sm:px-7 pt-3 sm:pt-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="min-w-0 pt-1.5 font-display text-title sm:text-[20px] font-semibold leading-snug">
            {results ? (sentCount ? "Enquiry sent" : "Nothing was sent") : `Send one enquiry to ${vendors.length} vendor${vendors.length === 1 ? "" : "s"}`}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-2 shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-full hover:bg-surface-muted"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {results ? (
          <div className="mt-3">
            <p role="status" className={sentCount ? "alert-success" : "alert-error"}>
              {sentCount
                ? `Sent to ${sentCount} of ${results.length}. Replies and offers will show in your enquiries.`
                : "None of these vendors can take enquiries right now."}
            </p>
            <ul className="mt-3 divide-y divide-line border border-line rounded-card" aria-label="Results per vendor">
              {results.map((r) => (
                <li key={r.vendorId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium truncate">{names.get(r.vendorId) ?? `Vendor ${r.vendorId}`}</p>
                    <p className={`text-caption mt-0.5 ${r.ok ? "text-accent-hover" : "text-danger"}`}>
                      {r.ok ? (r.warnings?.length ? `Sent · ${r.warnings[0].message ?? "check the date"}` : "Sent") : r.error}
                    </p>
                  </div>
                  {r.ok && (
                    <Link href={`/my/enquiries/${r.enquiryId}`} className="btn btn-secondary btn-sm shrink-0">
                      View
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-primary btn-block mt-4" onClick={close}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-2 flex flex-col gap-4">
            <ul className="flex flex-wrap gap-1.5" aria-label="Sending to">
              {vendors.map((v) => (
                <li key={v.vendorId} className="chip bg-accent-tint text-accent-hover max-w-full truncate">
                  {v.name}
                </li>
              ))}
            </ul>

            {prefilled && (
              <p className="hint -mt-1">
                Filled in from {defaults.source ? `your ${defaults.source} enquiry` : "your earlier enquiry"}. Change anything
                that&apos;s different for these vendors.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`${f}-name`} label="Your name" error={fieldError("name")}>
                <input id={`${f}-name`} name="name" className="field" defaultValue={defaults.name} required autoComplete="name" aria-invalid={inv("name")} />
              </Field>
              <Field id={`${f}-phone`} label="Phone number" error={fieldError("phone")} hint="WhatsApp number preferred. +971 and other codes work.">
                <input id={`${f}-phone`} name="phone" type="tel" inputMode="tel" className="field" defaultValue={defaults.phone} required autoComplete="tel" aria-invalid={inv("phone")} />
              </Field>
              <Field id={`${f}-eventDate`} label="Event date" error={fieldError("eventDate")}>
                <input id={`${f}-eventDate`} name="eventDate" type="date" min={today} className="field" defaultValue={pre.eventDate} aria-invalid={inv("eventDate")} />
              </Field>
              <Field id={`${f}-eventTypeId`} label="Occasion" error={fieldError("eventTypeId")}>
                <select id={`${f}-eventTypeId`} name="eventTypeId" className="field" defaultValue={pre.eventTypeId} aria-invalid={inv("eventTypeId")}>
                  <option value="">Choose…</option>
                  {eventTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={`${f}-districtId`} label="District" error={fieldError("districtId")}>
                <select id={`${f}-districtId`} name="districtId" className="field" defaultValue={pre.districtId} aria-invalid={inv("districtId")}>
                  <option value="">Choose…</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={`${f}-guestCount`} label="Guests" error={fieldError("guestCount")}>
                <input id={`${f}-guestCount`} name="guestCount" type="number" inputMode="numeric" min={1} className="field" defaultValue={pre.guestCount} aria-invalid={inv("guestCount")} />
              </Field>
              <Field id={`${f}-budget`} label="Budget" error={fieldError("budget")}>
                <select id={`${f}-budget`} name="budget" className="field" defaultValue={pre.budget} aria-invalid={inv("budget")}>
                  {BUDGETS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={`${f}-preferredContact`} label="Reach me by" error={fieldError("preferredContact")}>
                <select id={`${f}-preferredContact`} name="preferredContact" className="field" defaultValue={defaults.preferredContact} aria-invalid={inv("preferredContact")}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="call">Phone call</option>
                  <option value="email">Email</option>
                </select>
              </Field>
            </div>
            <Field id={`${f}-message`} label="Message" error={fieldError("message")} hint="Each vendor gets the same details and can reply separately.">
              <textarea id={`${f}-message`} name="message" className="field" maxLength={1000} placeholder="Tell them about your event" aria-invalid={inv("message")} />
            </Field>

            {error && !error.field && (
              <p role="alert" className="alert-error">
                {error.text}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Sending…" : `Send to ${vendors.length} vendor${vendors.length === 1 ? "" : "s"}`}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-caption text-danger mt-1">
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}
