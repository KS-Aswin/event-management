"use client";

import { useId, useState } from "react";
import { StepActions } from "./step-actions";
import type { StepProps } from "./types";

type AreaDraft = { fee: string; note: string };

export default function StepAreas({ tax, data, saveListing, next, back }: StepProps) {
  const uid = useId();
  const l = data.listing;
  const homeId = l?.districtId ?? null;
  const home = tax.districts.find((d) => d.id === homeId);
  const [areas, setAreas] = useState<Record<number, AreaDraft>>(() => {
    const m: Record<number, AreaDraft> = {};
    for (const a of data.serviceAreas) {
      if (a.district_id === homeId) continue;
      m[a.district_id] = { fee: a.travel_fee != null ? String(a.travel_fee) : "", note: a.travel_note ?? "" };
    }
    return m;
  });
  const [outside, setOutside] = useState(l?.travelOutsideKerala ?? false);
  const [perDay, setPerDay] = useState(String(l?.maxEventsPerDay ?? 1));
  const [maxGuests, setMaxGuests] = useState(l?.maxGuests != null ? String(l.maxGuests) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = tax.districts.filter((d) => d.id !== homeId);
  const allOn = others.length > 0 && others.every((d) => areas[d.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const serviceAreas = [
      ...(homeId ? [{ districtId: homeId, travelFee: null, travelNote: null }] : []),
      ...Object.entries(areas).map(([id, a]) => ({
        districtId: Number(id),
        travelFee: a.fee === "" ? null : Number(a.fee),
        travelNote: a.note.trim() || null,
      })),
    ];
    const r = await saveListing({
      serviceAreas,
      travelOutsideKerala: outside,
      maxEventsPerDay: perDay === "" ? 1 : Number(perDay),
      maxGuests: maxGuests === "" ? null : Number(maxGuests),
      onboardingStep: 5,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await next();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <p className="text-lead text-ink-soft -mt-3">
        Customers searching in these districts will find you. Add a travel fee or a note where it applies.
      </p>

      <fieldset>
        <legend className="text-title font-semibold">Districts you serve</legend>
        <p className="text-body text-ink-soft mt-1 mb-3">
          {home ? (
            <>
              Your home district, <strong className="text-foreground">{home.name}</strong>, is always included.
            </>
          ) : (
            "Set your home district in step 1."
          )}
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm mb-2 -ml-3"
          onClick={() =>
            setAreas(allOn ? {} : Object.fromEntries(others.map((d) => [d.id, areas[d.id] ?? { fee: "", note: "" }])))
          }
        >
          {allOn ? "Clear all" : "Select all of Kerala"}
        </button>
        <ul className="flex flex-col divide-y divide-line border border-line rounded-card">
          {others.map((d) => {
            const a = areas[d.id];
            return (
              <li key={d.id} className="px-3 py-1">
                <label className="flex items-center gap-3 min-h-11 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--color-accent)]"
                    checked={!!a}
                    onChange={(e) => {
                      const n = { ...areas };
                      if (e.target.checked) n[d.id] = { fee: "", note: "" };
                      else delete n[d.id];
                      setAreas(n);
                    }}
                  />
                  <span className="text-sm">{d.name}</span>
                </label>
                {a && (
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-[140px_1fr] pb-3 pl-8">
                    <div>
                      <label htmlFor={`${uid}-fee-${d.id}`} className="label !text-caption">
                        Travel fee (₹)
                      </label>
                      <input
                        id={`${uid}-fee-${d.id}`}
                        className="field"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="Free"
                        value={a.fee}
                        onChange={(e) => setAreas({ ...areas, [d.id]: { ...a, fee: e.target.value } })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`${uid}-note-${d.id}`} className="label !text-caption">
                        Note <span className="text-ink-soft font-normal">(optional)</span>
                      </label>
                      <input
                        id={`${uid}-note-${d.id}`}
                        className="field"
                        maxLength={200}
                        placeholder="e.g. Travel on request"
                        value={a.note}
                        onChange={(e) => setAreas({ ...areas, [d.id]: { ...a, note: e.target.value } })}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <label className="flex items-center gap-3 min-h-11 mt-3 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--color-accent)]"
            checked={outside}
            onChange={(e) => setOutside(e.target.checked)}
          />
          I also travel outside Kerala
        </label>
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="text-title font-semibold mb-1 sm:col-span-2">How much you can take on</legend>
        <div>
          <label htmlFor={`${uid}-perday`} className="label">
            Events per day
          </label>
          <input
            id={`${uid}-perday`}
            className="field"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            value={perDay}
            onChange={(e) => setPerDay(e.target.value)}
            aria-describedby={`${uid}-perday-hint`}
          />
          <p id={`${uid}-perday-hint`} className="hint">
            How many events you can cover on the same date (e.g. 2 teams).
          </p>
        </div>
        <div>
          <label htmlFor={`${uid}-guests`} className="label">
            Largest event (guests) <span className="text-ink-soft font-normal">(optional)</span>
          </label>
          <input
            id={`${uid}-guests`}
            className="field"
            type="number"
            inputMode="numeric"
            min={1}
            max={100000}
            value={maxGuests}
            onChange={(e) => setMaxGuests(e.target.value)}
          />
        </div>
      </fieldset>

      <StepActions onBack={back} busy={busy} error={error} />
    </form>
  );
}
