"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useConfirm } from "@/app/_components/confirm-dialog";
import type { CalendarLead, CalendarMonth, SlotEntry, SlotState } from "@/lib/availability";

type Slot = "full" | "morning" | "evening";
const SLOT_ORDER: Slot[] = ["full", "morning", "evening"];
const SLOT_LABEL: Record<Slot, string> = { full: "Full day", morning: "Morning", evening: "Evening" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CAPACITY = 50;

const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const fmtDay = (d: string) => dayFmt.format(utc(d));
const fmtShort = (d: string) => shortFmt.format(utc(d));

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function monthCells(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** One state for the whole day, for the grid cell. */
function dayState(entries: SlotEntry[] | undefined): SlotState | "partial" | null {
  if (!entries?.length) return null;
  const by = Object.fromEntries(entries.map((e) => [e.slot, e])) as Partial<Record<Slot, SlotEntry>>;
  const closed = (e?: SlotEntry) => !!e && (e.state === "blocked" || e.state === "full");
  if (by.full?.state === "blocked") return "blocked";
  if (by.full?.state === "full") return "full";
  if (closed(by.morning) && closed(by.evening)) {
    return by.morning!.state === "blocked" && by.evening!.state === "blocked" ? "blocked" : "full";
  }
  if (closed(by.morning) || closed(by.evening)) return "partial";
  if (entries.some((e) => e.state === "limited")) return "limited";
  return "open";
}

const CELL_TONE: Record<string, string> = {
  blocked: "bg-surface-muted text-ink-soft [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(201_205_210/0.45)_6px_7px)]",
  full: "bg-accent text-white",
  limited: "bg-[#fbf3d9] text-gold-ink",
  partial: "bg-[#fbf3d9] text-gold-ink",
  open: "",
};

function cellLabel(state: ReturnType<typeof dayState>, entries: SlotEntry[] | undefined): string | null {
  if (state === "blocked") return "Blocked";
  if (state === "full") return "Booked";
  if (state === "partial") return "Half day";
  if (state === "limited") {
    const e = entries?.find((x) => x.state === "limited");
    return e ? `${Math.max(e.capacityTotal - e.capacityUsed, 0)} left` : "Limited";
  }
  return null;
}

function stateText(e: SlotEntry | undefined, defaultCapacity: number): string {
  if (!e) return defaultCapacity > 1 ? `Open · ${defaultCapacity} events` : "Open";
  if (e.state === "blocked") return e.capacityUsed > 0 ? `Blocked · ${e.capacityUsed} booked` : "Blocked";
  if (e.state === "full") return `Fully booked · ${e.capacityUsed} of ${e.capacityTotal}`;
  if (e.state === "limited") return `Limited · ${e.capacityUsed} of ${e.capacityTotal} booked`;
  return `Open · ${e.capacityTotal} event${e.capacityTotal === 1 ? "" : "s"}`;
}

interface Change {
  action: "block" | "unblock" | "capacity";
  from: string;
  to?: string;
  slot: Slot;
  capacity?: number;
  note?: string | null;
  force?: boolean;
}

function leadLine(l: CalendarLead) {
  return `${l.name}${l.eventType ? `, ${l.eventType}` : ""} (${fmtShort(l.date)})`;
}

export default function CalendarClient({ data }: { data: CalendarMonth }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const [selected, setSelected] = useState<string | null>(() =>
    data.today.slice(0, 7) === data.month ? data.today : null
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const cells = monthCells(data.month);
  const bookingsOn = (d: string) => data.bookings.filter((b) => b.date === d);
  const openOn = (d: string) => data.openLeads.filter((b) => b.date === d);
  const isPast = (d: string) => d < data.today;

  async function send(change: Change, success: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/vendor/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && (body.code === "PENDING_LEADS" || body.code === "BOOKED_DATES") && !change.force) {
        const leads: CalendarLead[] = Array.isArray(body.leads) ? body.leads : [];
        const booked: CalendarLead[] = Array.isArray(body.bookings) ? body.bookings : [];
        const list = (l: CalendarLead[]) => `${l.slice(0, 4).map(leadLine).join("; ")}${l.length > 4 ? "; …" : ""}`;
        const parts: string[] = [];
        if (leads.length) {
          parts.push(`Open: ${list(leads)}. Blocking won't cancel ${leads.length === 1 ? "it" : "them"}; reply to let the customer know.`);
        }
        if (booked.length) {
          parts.push(
            `Booked: ${list(booked)}. ${booked.length === 1 ? "It stays" : "They stay"} on your calendar as Booked; only the free days are closed to new enquiries.`
          );
        }
        const ok = await confirm({
          title: leads.length
            ? leads.length === 1
              ? "There's an open enquiry on this date"
              : `${leads.length} open enquiries on these dates`
            : booked.length === 1
              ? "You have a booked event in these dates"
              : `${booked.length} booked events in these dates`,
          description: parts.join(" "),
          confirmLabel: "Block anyway",
        });
        if (!ok) return false;
        setBusy(false);
        return send({ ...change, force: true }, success);
      }
      if (!res.ok) {
        setMessage({ kind: "error", text: typeof body.error === "string" ? body.error : "Couldn't save. Please try again." });
        return false;
      }
      setMessage({ kind: "ok", text: success });
      startTransition(() => router.refresh());
      return true;
    } catch {
      setMessage({ kind: "error", text: "You seem to be offline. Nothing was changed." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const prev = shiftMonth(data.month, -1);
  const next = shiftMonth(data.month, 1);
  const pending = busy || refreshing;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <section aria-labelledby="month-h" className="card p-3 sm:p-5 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-3">
          <Link href={`?month=${prev}`} className="btn btn-ghost btn-sm min-w-11" aria-label="Previous month" scroll={false}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </Link>
          <h2 id="month-h" className="text-title font-semibold text-center" aria-live="polite">
            {monthFmt.format(utc(`${data.month}-01`))}
          </h2>
          <Link href={`?month=${next}`} className="btn btn-ghost btn-sm min-w-11" aria-label="Next month" scroll={false}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </Link>
        </div>

        <div className="select-none">
          <div aria-hidden="true" className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-caption text-ink-soft py-1">
                {w}
              </div>
            ))}
          </div>
          {Array.from({ length: cells.length / 7 }, (_, row) => (
            <div key={row} className="grid grid-cols-7 gap-1 mb-1">
              {cells.slice(row * 7, row * 7 + 7).map((d, i) => {
                if (!d) return <div key={`e${row}-${i}`} aria-hidden="true" />;
                const entries = data.days[d];
                const rawState = dayState(entries);
                // A blocked day with a confirmed booking still reads "Booked" (QA-013),
                // so the vendor never loses sight of an event by blocking around it.
                const hasBooking = bookingsOn(d).length > 0;
                const state = rawState === "blocked" && hasBooking ? "full" : rawState;
                const label = rawState === "blocked" && hasBooking ? "Booked" : cellLabel(state, entries);
                const nOpen = openOn(d).length;
                const isSel = selected === d;
                const isToday = d === data.today;
                const past = isPast(d);
                const desc = [label, nOpen ? `${nOpen} open enquir${nOpen === 1 ? "y" : "ies"}` : null].filter(Boolean).join(", ");
                return (
                  <div key={d}>
                    <button
                      type="button"
                      onClick={() => setSelected(d)}
                      aria-pressed={isSel}
                      aria-label={`${fmtDay(d)}${desc ? `: ${desc}` : ""}`}
                      data-date={d}
                      data-state={state ?? "open"}
                      data-blocked={rawState === "blocked" || undefined}
                      className={`relative w-full min-h-12 sm:min-h-[68px] rounded-control border text-left px-1.5 py-1 sm:px-2 transition-colors ${
                        state ? CELL_TONE[state] : "bg-surface"
                      } ${isSel ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-line-strong"} ${
                        past ? "opacity-55" : ""
                      }`}
                    >
                      <span
                        className={`text-[13px] sm:text-sm tabular-nums ${isToday ? "font-bold underline underline-offset-4" : "font-medium"}`}
                      >
                        {Number(d.slice(8))}
                      </span>
                      {label && <span className="hidden sm:block text-[11px] leading-tight mt-0.5 font-medium truncate">{label}</span>}
                      {nOpen > 0 && (
                        <span
                          aria-hidden="true"
                          className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${state === "full" ? "bg-white" : "bg-gold"}`}
                        />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-caption text-ink-soft" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`w-3.5 h-3.5 rounded-sm border border-line ${CELL_TONE.blocked}`} /> Blocked
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-3.5 h-3.5 rounded-sm bg-accent" /> Booked
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-3.5 h-3.5 rounded-sm bg-[#fbf3d9] border border-[#efe0a8]" /> Limited or half day
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-gold" /> Open enquiry
          </li>
        </ul>
      </section>

      <div className="flex flex-col gap-5 min-w-0">
        <div aria-live="polite" className="empty:hidden">
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "alert-error" : "alert-success"}>
              {message.text}
            </p>
          )}
        </div>

        {selected && selected.slice(0, 7) === data.month ? (
          <DayPanel
            key={selected}
            date={selected}
            entries={data.days[selected]}
            bookings={bookingsOn(selected)}
            openLeads={openOn(selected)}
            defaultCapacity={data.defaultCapacity}
            past={isPast(selected)}
            pending={pending}
            send={send}
          />
        ) : (
          <section className="card">
            <h2 className="text-title font-semibold">Pick a day</h2>
            <p className="text-body text-ink-soft mt-1">Tap a date to block it, block a morning or evening, or set how many events you can take.</p>
          </section>
        )}

        <RangeForm today={data.today} pending={pending} send={send} />
      </div>
      {confirmDialog}
    </div>
  );
}

function DayPanel({
  date,
  entries,
  bookings,
  openLeads,
  defaultCapacity,
  past,
  pending,
  send,
}: {
  date: string;
  entries: SlotEntry[] | undefined;
  bookings: CalendarLead[];
  openLeads: CalendarLead[];
  defaultCapacity: number;
  past: boolean;
  pending: boolean;
  send: (c: Change, success: string) => Promise<boolean>;
}) {
  const by = Object.fromEntries((entries ?? []).map((e) => [e.slot, e])) as Partial<Record<Slot, SlotEntry>>;
  const uid = useId();
  const [capSlot, setCapSlot] = useState<Slot | null>(null);

  return (
    <section className="card" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className="text-title font-semibold">
        {fmtDay(date)}
      </h2>
      {past && <p className="hint mt-1">This date has passed, so it can&apos;t be changed.</p>}

      {(bookings.length > 0 || openLeads.length > 0) && (
        <div className="mt-3 flex flex-col gap-3">
          {bookings.length > 0 && (
            <div>
              <h3 className="eyebrow mb-1">Booked</h3>
              <ul className="flex flex-col">
                {bookings.map((b) => (
                  <li key={b.id}>
                    <Link href={`/vendor/leads/${b.id}`} className="flex items-center justify-between gap-2 min-h-11 text-body text-accent hover:underline">
                      <span className="truncate">
                        {b.name}
                        {b.eventType ? ` · ${b.eventType}` : ""}
                      </span>
                      <span className="text-caption text-ink-soft shrink-0">{b.slot ? SLOT_LABEL[b.slot as Slot] ?? b.slot : "Full day"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {openLeads.length > 0 && (
            <div>
              <h3 className="eyebrow mb-1">Open enquiries</h3>
              <ul className="flex flex-col">
                {openLeads.map((b) => (
                  <li key={b.id}>
                    <Link href={`/vendor/leads/${b.id}`} className="flex items-center justify-between gap-2 min-h-11 text-body text-accent hover:underline">
                      <span className="truncate">
                        {b.name}
                        {b.eventType ? ` · ${b.eventType}` : ""}
                      </span>
                      <span className="chip shrink-0">{b.status === "pending" ? "New" : b.status === "accepted" ? "Accepted" : "Replied"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ul className="mt-3 flex flex-col">
        {SLOT_ORDER.map((slot) => {
          const e = by[slot];
          const blocked = e?.state === "blocked";
          return (
            <li key={slot} className="py-3 border-t border-line first:border-t-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body font-medium">{SLOT_LABEL[slot]}</p>
                  <p className="text-caption text-ink-soft" data-slot-state={slot}>
                    {stateText(e, defaultCapacity)}
                  </p>
                  {e?.note && <p className="text-caption mt-0.5">&ldquo;{e.note}&rdquo;</p>}
                </div>
                {!past && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={pending}
                      aria-expanded={capSlot === slot}
                      onClick={() => setCapSlot(capSlot === slot ? null : slot)}
                      aria-label={`Set capacity for ${SLOT_LABEL[slot].toLowerCase()}`}
                    >
                      Capacity
                    </button>
                    <button
                      type="button"
                      className={"btn btn-secondary btn-sm"}
                      disabled={pending}
                      onClick={() =>
                        send(
                          { action: blocked ? "unblock" : "block", from: date, slot },
                          blocked ? `${fmtShort(date)} ${SLOT_LABEL[slot].toLowerCase()} is open again.` : `${fmtShort(date)} ${SLOT_LABEL[slot].toLowerCase()} blocked.`
                        )
                      }
                    >
                      {blocked ? "Unblock" : "Block"}
                      <span className="sr-only"> {SLOT_LABEL[slot].toLowerCase()}</span>
                    </button>
                  </div>
                )}
              </div>
              {capSlot === slot && !past && (
                <CapacityForm
                  initial={e?.capacityTotal ?? defaultCapacity}
                  min={Math.max(1, e?.capacityUsed ?? 0)}
                  pending={pending}
                  onSave={async (n) => {
                    const ok = await send(
                      { action: "capacity", from: date, slot, capacity: n },
                      `${SLOT_LABEL[slot]} on ${fmtShort(date)}: up to ${n} event${n === 1 ? "" : "s"}.`
                    );
                    if (ok) setCapSlot(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="hint">
        Full day covers the whole date. Your usual limit is {defaultCapacity} event{defaultCapacity === 1 ? "" : "s"} a day (change it in{" "}
        <Link href="/vendor/profile" className="text-accent underline underline-offset-2 hover:text-accent-hover">
          Profile
        </Link>
        ).
      </p>
    </section>
  );
}

function CapacityForm({
  initial,
  min,
  pending,
  onSave,
}: {
  initial: number;
  min: number;
  pending: boolean;
  onSave: (n: number) => void;
}) {
  const uid = useId();
  const [value, setValue] = useState(String(initial));
  const n = Number(value);
  const invalid = !Number.isInteger(n) || n < min || n > MAX_CAPACITY;
  return (
    <form
      className="mt-2 flex items-end gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!invalid) onSave(n);
      }}
    >
      <div className="flex-1">
        <label htmlFor={`${uid}-cap`} className="label">
          Events you can take
        </label>
        <input
          id={`${uid}-cap`}
          type="number"
          inputMode="numeric"
          min={min}
          max={MAX_CAPACITY}
          step={1}
          value={value}
          onChange={(ev) => setValue(ev.target.value)}
          aria-invalid={invalid}
          aria-describedby={`${uid}-hint`}
          className="field"
        />
        <p id={`${uid}-hint`} className="hint">
          {min > 1 ? `At least ${min} (already booked).` : "e.g. 2 if you run two teams."}
        </p>
      </div>
      <button type="submit" className="btn btn-primary mb-[26px]" disabled={pending || invalid}>
        Save
      </button>
    </form>
  );
}

function RangeForm({
  today,
  pending,
  send,
}: {
  today: string;
  pending: boolean;
  send: (c: Change, success: string) => Promise<boolean>;
}) {
  const uid = useId();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [slot, setSlot] = useState<Slot>("full");
  const [note, setNote] = useState("");
  const [error, setError] = useState<{ field: "from" | "to" | null; text: string } | null>(null);

  async function submit(action: "block" | "unblock") {
    setError(null);
    if (!from) return setError({ field: "from", text: "Pick a start date." });
    if (from < today) return setError({ field: "from", text: "Past dates can't be changed. Pick today or later." });
    const end = to || from;
    if (end < from) return setError({ field: "to", text: "The end date must be on or after the start date." });
    const ok = await send(
      { action, from, to: end, slot, note: action === "block" ? note.trim() || null : null },
      action === "block" ? `Blocked ${fmtShort(from)}${end !== from ? ` to ${fmtShort(end)}` : ""}.` : `Opened ${fmtShort(from)}${end !== from ? ` to ${fmtShort(end)}` : ""} again.`
    );
    if (ok) setNote("");
  }

  return (
    <section className="card" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className="text-title font-semibold">
        Block a range
      </h2>
      <p className="text-body text-ink-soft mt-1">For holidays, Ramadan, the monsoon or a long event. Up to 120 days at a time.</p>
      <form
        className="mt-3 grid grid-cols-2 gap-3"
        // Checked in submit() so every mistake gets an inline message (the
        // browser's own bubble for min= was easy to miss: QA-013).
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          submit("block");
        }}
      >
        <div>
          <label htmlFor={`${uid}-from`} className="label">
            From
          </label>
          <input
            id={`${uid}-from`}
            type="date"
            min={today}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setError(null);
            }}
            className="field"
            required
            aria-invalid={error?.field === "from" || undefined}
            aria-describedby={error?.field === "from" ? `${uid}-err` : undefined}
          />
        </div>
        <div>
          <label htmlFor={`${uid}-to`} className="label">
            To
          </label>
          <input
            id={`${uid}-to`}
            type="date"
            min={from || today}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setError(null);
            }}
            className="field"
            aria-invalid={error?.field === "to" || undefined}
            aria-describedby={error?.field === "to" ? `${uid}-err` : undefined}
          />
        </div>
        <div className="col-span-2">
          <label htmlFor={`${uid}-slot`} className="label">
            Which part of the day
          </label>
          <select id={`${uid}-slot`} value={slot} onChange={(e) => setSlot(e.target.value as Slot)} className="field">
            {SLOT_ORDER.map((s) => (
              <option key={s} value={s}>
                {SLOT_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor={`${uid}-note`} className="label">
            Note <span className="text-ink-soft font-normal">(only you see it)</span>
          </label>
          <input
            id={`${uid}-note`}
            type="text"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Family wedding"
            className="field"
          />
        </div>
        {error && (
          <p id={`${uid}-err`} role="alert" className="alert-error col-span-2" data-range-error>
            {error.text}
          </p>
        )}
        <div className="col-span-2 flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary flex-1 sm:flex-none" disabled={pending}>
            Block dates
          </button>
          <button type="button" className="btn btn-secondary flex-1 sm:flex-none" disabled={pending} onClick={() => submit("unblock")}>
            Unblock dates
          </button>
        </div>
      </form>
    </section>
  );
}
