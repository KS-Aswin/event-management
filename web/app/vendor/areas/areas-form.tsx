"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PROFILE_LIMITS, travelLabel } from "@/app/api/vendor/profile/validate";

type District = { id: number; name: string };
type Area = { districtId: number; travelFee: number | null; travelNote: string | null };
type Row = { fee: string; note: string };

function toRows(areas: Area[]): Record<number, Row> {
  const r: Record<number, Row> = {};
  for (const a of areas) r[a.districtId] = { fee: a.travelFee ? String(a.travelFee) : "", note: a.travelNote ?? "" };
  return r;
}

export default function AreasForm({
  districts,
  home,
  initialAreas,
  initialOutsideKerala,
}: {
  districts: District[];
  home: District | null;
  initialAreas: Area[];
  initialOutsideKerala: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<number, Row>>(() => toRows(initialAreas));
  const [outside, setOutside] = useState(initialOutsideKerala);
  const [saved, setSaved] = useState(() => JSON.stringify({ rows: toRows(initialAreas), outside: initialOutsideKerala }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErr, setFieldErr] = useState<{ id: number; text: string } | null>(null);

  const others = districts.filter((d) => d.id !== home?.id);
  const selected = others.filter((d) => rows[d.id]);
  const dirty = JSON.stringify({ rows, outside }) !== saved;
  const allOn = selected.length === others.length && others.length > 0;

  const nameOf = useMemo(() => new Map(districts.map((d) => [d.id, d.name])), [districts]);

  function toggle(id: number) {
    setMsg(null);
    setRows((r) => {
      const next = { ...r };
      if (next[id]) delete next[id];
      else next[id] = { fee: "", note: "" };
      return next;
    });
  }

  function update(id: number, patch: Partial<Row>) {
    setMsg(null);
    if (fieldErr?.id === id) setFieldErr(null);
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setFieldErr(null);
    const areas = Object.entries(rows).map(([id, r]) => ({
      districtId: Number(id),
      travelFee: r.fee ? Number(r.fee) : null,
      travelNote: r.note.trim() || null,
    }));
    try {
      const res = await fetch("/api/vendor/profile/areas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areas, travelOutsideKerala: outside }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const m = /^areas\.(\d+)/.exec(String(data.field ?? ""));
        if (m && areas[Number(m[1])]) setFieldErr({ id: areas[Number(m[1])].districtId, text: data.error });
        setMsg({ ok: false, text: typeof data.error === "string" ? data.error : "Couldn't save. Please try again." });
        return;
      }
      const nextRows = toRows(
        (data.areas as { district_id: number; travel_fee: number | null; travel_note: string | null }[]).map((a) => ({
          districtId: a.district_id,
          travelFee: a.travel_fee,
          travelNote: a.travel_note,
        }))
      );
      setRows(nextRows);
      setOutside(!!data.travelOutsideKerala);
      setSaved(JSON.stringify({ rows: nextRows, outside: !!data.travelOutsideKerala }));
      setMsg({ ok: true, text: "Saved" });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "You seem to be offline. Nothing was saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="flex flex-col gap-5 min-w-0">
        <section className="card sm:p-6" aria-labelledby="home-h">
          <h2 id="home-h" className="text-title font-semibold">
            Home district
          </h2>
          {home ? (
            <p className="text-body mt-1">
              <span className="font-medium">{home.name}</span>
              <span className="text-ink-soft"> is always included, with no travel fee. </span>
              <Link href="/vendor/profile#location" className="text-accent font-medium hover:underline underline-offset-2">
                Change
              </Link>
            </p>
          ) : (
            <p className="text-body mt-1 text-ink-soft">
              You haven&apos;t set a home district yet.{" "}
              <Link href="/vendor/profile#location" className="text-accent font-medium hover:underline underline-offset-2">
                Set it in your profile
              </Link>
            </p>
          )}
        </section>

        <fieldset className="card sm:p-6">
          <legend className="sr-only">Other districts you travel to</legend>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-title font-semibold" aria-hidden="true">
              Other districts
            </h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm -mr-3"
              onClick={() => {
                setMsg(null);
                setRows((r) => {
                  if (allOn) return {};
                  const next = { ...r };
                  for (const d of others) next[d.id] ??= { fee: "", note: "" };
                  return next;
                });
              }}
            >
              {allOn ? "Clear all" : "Select all of Kerala"}
            </button>
          </div>
          <p className="text-body text-ink-soft mt-0.5 mb-3">Tick every district you are happy to travel to.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {others.map((d) => {
              const on = !!rows[d.id];
              return (
                <label
                  key={d.id}
                  className={`flex items-center gap-2.5 min-h-11 px-3 rounded-control border text-sm cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                    on ? "border-accent bg-accent-tint text-accent-hover font-medium" : "border-line-strong hover:bg-surface-muted"
                  }`}
                >
                  <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={on} onChange={() => toggle(d.id)} />
                  {d.name}
                </label>
              );
            })}
          </div>

          <label className="flex items-start gap-3 mt-5 pt-4 border-t border-line cursor-pointer min-h-11">
            <input
              type="checkbox"
              className="size-4 mt-0.5 accent-[var(--color-accent)]"
              checked={outside}
              onChange={(e) => {
                setOutside(e.target.checked);
                setMsg(null);
              }}
            />
            <span>
              <span className="block text-sm font-medium">I also travel outside Kerala</span>
              <span className="block text-caption text-ink-soft">Your profile shows &ldquo;Travels across India&rdquo;.</span>
            </span>
          </label>
        </fieldset>

        {selected.length > 0 && (
          <section className="card sm:p-6" aria-labelledby="travel-h">
            <h2 id="travel-h" className="text-title font-semibold">
              Travel charges
            </h2>
            <p className="text-body text-ink-soft mt-0.5 mb-2">
              Leave both empty if you don&apos;t charge for travel. A note alone shows as &ldquo;Travel on request&rdquo;.
            </p>
            <ul>
              {selected.map((d) => {
                const r = rows[d.id];
                const err = fieldErr?.id === d.id ? fieldErr.text : null;
                return (
                  <li key={d.id} className="py-3 border-b border-line last:border-b-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-medium text-body">{d.name}</span>
                      <span className="text-caption text-ink-soft">
                        {travelLabel(r.fee ? Number(r.fee) : null, r.note)}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                      <div>
                        <label htmlFor={`fee-${d.id}`} className="sr-only">
                          Travel fee to {d.name} in rupees
                        </label>
                        <div className="relative">
                          <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft">
                            ₹
                          </span>
                          <input
                            id={`fee-${d.id}`}
                            className="field pl-7"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="Fee"
                            aria-invalid={err ? true : undefined}
                            value={r.fee}
                            onChange={(e) => update(d.id, { fee: e.target.value.replace(/\D/g, "").slice(0, 7) })}
                          />
                        </div>
                      </div>
                      <div>
                        <label htmlFor={`note-${d.id}`} className="sr-only">
                          Travel note for {d.name}
                        </label>
                        <input
                          id={`note-${d.id}`}
                          className="field"
                          placeholder="Note, e.g. stay arranged by client"
                          maxLength={PROFILE_LIMITS.travelNote}
                          aria-invalid={err ? true : undefined}
                          value={r.note}
                          onChange={(e) => update(d.id, { note: e.target.value })}
                        />
                      </div>
                    </div>
                    {err && <p className="text-caption text-danger mt-1">{err}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <aside className="card lg:sticky lg:top-[calc(var(--header-h)+16px)]" aria-labelledby="sum-h">
        <h2 id="sum-h" className="text-title font-semibold">
          Summary
        </h2>
        <p className="text-body text-ink-soft mt-1">
          {home ? `${home.name} plus ` : ""}
          {selected.length} other district{selected.length === 1 ? "" : "s"}
          {outside ? ", and outside Kerala" : ""}.
        </p>
        {selected.length > 0 && (
          <p className="text-caption text-ink-soft mt-2 line-clamp-3">
            {selected.map((d) => nameOf.get(d.id)).join(", ")}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <button type="submit" className="btn btn-primary btn-block" disabled={!dirty || busy}>
            {busy ? "Saving…" : "Save districts"}
          </button>
          <p aria-live="polite" className="text-caption min-h-5">
            {msg ? (
              <span className={msg.ok ? "text-accent" : "text-danger"}>{msg.text}</span>
            ) : dirty ? (
              <span className="text-ink-soft">Unsaved changes</span>
            ) : null}
          </p>
        </div>
      </aside>
    </form>
  );
}
