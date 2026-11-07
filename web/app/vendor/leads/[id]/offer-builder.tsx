"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPaise, lineAmountPaise, rupeesToPaise, todayIST } from "@/lib/offer-math";

// Vendor offer builder (PRODUCT_PLAN P2-4): lines pre-filled from the units
// the customer asked for (x qty) or from the latest offer when revising,
// travel from the service area, GST only with a GSTIN, validity, advance %
// and terms. Totals are shown live; the server recomputes and checks them.

export interface BuilderUnit {
  serviceId: number;
  title: string;
  qty: number | null;
  priceFrom: number | null;
  priceUnit: string | null;
  unitLabel: string | null;
}

export interface BuilderOffer {
  lines: { serviceId: number | null; label: string; qty: number; unit: string; unitPricePaise: number }[];
  travelPaise: number;
  discountPaise: number;
  gstPaise: number;
  advancePct: number | null;
  terms: string;
}

interface Line {
  key: number;
  serviceId: number | null;
  label: string;
  qty: string;
  unit: string;
  unitPrice: string;
}

const PER_HEAD = new Set(["plate", "person"]);

function paiseToRupeesText(p: number): string {
  return p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2);
}

function qtyHundredths(v: string): number | null {
  const s = v.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const h = Number(w) * 100 + Number((f + "00").slice(0, 2));
  return h > 0 ? h : null;
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
const nextKey = () => ++seq;

function initialLines(units: BuilderUnit[], guestCount: number | null, previous: BuilderOffer | null): Line[] {
  if (previous) {
    return previous.lines.map((l) => ({
      key: nextKey(),
      serviceId: l.serviceId,
      label: l.label,
      qty: String(l.qty),
      unit: l.unit,
      unitPrice: paiseToRupeesText(l.unitPricePaise),
    }));
  }
  const fromUnits = units.map((u) => ({
    key: nextKey(),
    serviceId: u.serviceId,
    label: u.title,
    qty: String(u.qty ?? (u.priceUnit && PER_HEAD.has(u.priceUnit) && guestCount ? guestCount : 1)),
    unit: u.unitLabel || u.priceUnit || "",
    unitPrice: u.priceFrom ? String(u.priceFrom) : "",
  }));
  return fromUnits.length ? fromUnits : [{ key: nextKey(), serviceId: null, label: "", qty: "1", unit: "", unitPrice: "" }];
}

export default function OfferBuilder({
  leadId,
  units,
  guestCount,
  hasGstin,
  travelFee,
  previous,
  version,
}: {
  leadId: number;
  units: BuilderUnit[];
  guestCount: number | null;
  hasGstin: boolean;
  travelFee: number | null;
  /** The latest offer, to start a revision from. */
  previous: BuilderOffer | null;
  /** The version this offer will be (1 for the first). */
  version: number;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => initialLines(units, guestCount, previous));
  const [travel, setTravel] = useState(previous ? paiseToRupeesText(previous.travelPaise) : travelFee ? String(travelFee) : "");
  const [discount, setDiscount] = useState(previous && previous.discountPaise ? paiseToRupeesText(previous.discountPaise) : "");
  const [gst, setGst] = useState(previous && previous.gstPaise && hasGstin ? paiseToRupeesText(previous.gstPaise) : "");
  const [validUntil, setValidUntil] = useState(() => addDays(todayIST(), 14));
  const [advance, setAdvance] = useState(previous?.advancePct != null ? String(previous.advancePct) : "");
  const [terms, setTerms] = useState(previous?.terms ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amounts = lines.map((l) => {
    const q = qtyHundredths(l.qty);
    const p = rupeesToPaise(l.unitPrice);
    return q !== null && p !== null ? lineAmountPaise(q, p) : null;
  });
  const subtotal = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const money = (v: string) => (v.trim() === "" ? 0 : rupeesToPaise(v));
  const travelP = money(travel);
  const discountP = money(discount);
  const gstP = hasGstin ? money(gst) : 0;
  const total = subtotal + (travelP ?? 0) + (gstP ?? 0) - (discountP ?? 0);
  const missing = units.filter((u) => !lines.some((l) => l.serviceId === u.serviceId));

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const bad = lines.findIndex((l, i) => l.label.trim().length < 2 || amounts[i] === null);
    if (bad !== -1) {
      setError(`Line ${bad + 1}: fill in the item, a quantity above 0 and a price.`);
      return;
    }
    if (travelP === null || discountP === null || gstP === null) {
      setError("Travel, discount and GST must be amounts in rupees.");
      return;
    }
    if (total <= 0) {
      setError("The total must be more than ₹0.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/vendor/leads/${leadId}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({ serviceId: l.serviceId, label: l.label.trim(), qty: l.qty.trim(), unit: l.unit.trim(), unitPrice: l.unitPrice.trim() })),
          subtotal: paiseToRupeesText(subtotal),
          travel: paiseToRupeesText(travelP),
          discount: paiseToRupeesText(discountP),
          gst: paiseToRupeesText(gstP),
          total: paiseToRupeesText(total),
          validUntil: validUntil || null,
          advancePct: advance.trim() === "" ? null : Number(advance),
          terms,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === "string" ? data.error : "Couldn't send the offer. Please try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("You seem to be offline. The offer wasn't sent.");
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {version > 1 ? `Send a revised offer (v${version})` : "Build an itemised offer"}
      </button>
    );
  }

  const today = todayIST();
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label={`Offer v${version}`} noValidate>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-[15px] font-semibold mb-1">Items</legend>
        {lines.map((l, i) => (
          <div key={l.key} className="rounded-card border border-line p-3 grid gap-2 grid-cols-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_7.5rem]">
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor={`${uid}-label-${l.key}`} className="label">
                Item {i + 1}
              </label>
              <input
                id={`${uid}-label-${l.key}`}
                className="field"
                value={l.label}
                maxLength={120}
                onChange={(e) => update(l.key, { label: e.target.value })}
                placeholder="e.g. Candid photography"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-qty-${l.key}`} className="label">
                Qty
              </label>
              <input id={`${uid}-qty-${l.key}`} className="field tabular-nums" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${uid}-unit-${l.key}`} className="label">
                Unit
              </label>
              <input id={`${uid}-unit-${l.key}`} className="field" maxLength={30} value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} placeholder="Optional, e.g. day" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor={`${uid}-price-${l.key}`} className="label">
                Price per unit (₹)
              </label>
              <input
                id={`${uid}-price-${l.key}`}
                className="field tabular-nums"
                inputMode="decimal"
                value={l.unitPrice}
                onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                placeholder="0"
              />
            </div>
            <div className="col-span-2 sm:col-span-4 flex items-center justify-between gap-2">
              <span className="text-body tabular-nums">
                Amount <span className="font-semibold">{amounts[i] === null ? "–" : formatPaise(amounts[i]!)}</span>
              </span>
              {lines.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  Remove<span className="sr-only"> item {i + 1}</span>
                </button>
              )}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={lines.length >= 40}
            onClick={() => setLines((ls) => [...ls, { key: nextKey(), serviceId: null, label: "", qty: "1", unit: "", unitPrice: "" }])}
          >
            + Add a line
          </button>
          {missing.map((u) => (
            <button
              key={u.serviceId}
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setLines((ls) => [
                  ...ls,
                  { key: nextKey(), serviceId: u.serviceId, label: u.title, qty: String(u.qty ?? 1), unit: u.unitLabel || u.priceUnit || "", unitPrice: u.priceFrom ? String(u.priceFrom) : "" },
                ])
              }
            >
              + {u.title}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
        <div>
          <label htmlFor={`${uid}-travel`} className="label">
            Travel (₹)
          </label>
          <input id={`${uid}-travel`} className="field tabular-nums" inputMode="decimal" value={travel} onChange={(e) => setTravel(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label htmlFor={`${uid}-discount`} className="label">
            Discount (₹)
          </label>
          <input id={`${uid}-discount`} className="field tabular-nums" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
        </div>
        {hasGstin ? (
          <div>
            <label htmlFor={`${uid}-gst`} className="label">
              GST (₹)
            </label>
            <input id={`${uid}-gst`} className="field tabular-nums" inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} placeholder="0" aria-describedby={`${uid}-gst-hint`} />
            <p id={`${uid}-gst-hint`} className="hint">
              Enter the GST amount you charge.
            </p>
          </div>
        ) : (
          <p className="hint col-span-2 sm:col-span-1 self-end">
            To add GST, first add your GSTIN in <a href="/vendor/profile" className="underline">your business profile</a>.
          </p>
        )}
        <div>
          <label htmlFor={`${uid}-valid`} className="label">
            Valid until
          </label>
          <input id={`${uid}-valid`} type="date" className="field" min={today} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-advance`} className="label">
            Advance (%)
          </label>
          <input id={`${uid}-advance`} className="field tabular-nums" inputMode="numeric" value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="e.g. 25" />
        </div>
      </div>

      <div>
        <label htmlFor={`${uid}-terms`} className="label">
          Terms (optional)
        </label>
        <textarea
          id={`${uid}-terms`}
          className="field"
          rows={3}
          maxLength={2000}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          placeholder="e.g. Advance is non-refundable within 30 days of the event. Final album in 6 weeks."
        />
      </div>

      <dl className="rounded-card bg-surface-muted p-3 text-body">
        <div className="flex justify-between">
          <dt className="text-ink-soft">Subtotal</dt>
          <dd className="tabular-nums">{formatPaise(subtotal)}</dd>
        </div>
        <div className="flex justify-between text-[15px] font-semibold mt-1">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="offer-total">
            {formatPaise(Math.max(total, 0))}
          </dd>
        </div>
      </dl>

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={sending} aria-busy={sending}>
          {sending ? "Sending…" : version > 1 ? `Send offer v${version}` : "Send offer"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={sending}>
          Cancel
        </button>
      </div>
      {version > 1 && <p className="hint -mt-2">Sending this replaces your previous offer. The customer is notified.</p>}
    </form>
  );
}
