"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AvailabilityManager({
  vendorId,
  initialDates,
}: {
  vendorId: number;
  initialDates: string[];
}) {
  const router = useRouter();
  const [dates, setDates] = useState<string[]>(initialDates);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  function add() {
    if (!pick || dates.includes(pick)) return;
    setDates((prev) => [...prev, pick].sort());
    setPick("");
    setMessage(null);
  }

  function remove(d: string) {
    setDates((prev) => prev.filter((x) => x !== d));
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/vendors/${vendorId}/availability`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dates }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage({ ok: false, text: data.error ?? "Something went wrong." });
      return;
    }
    setDates(data.unavailableDates);
    setMessage({ ok: true, text: "Saved." });
    router.refresh();
  }

  return (
    <div className="border border-line rounded-xl p-5.5 space-y-4">
      <div className="flex gap-2">
        <input
          type="date"
          value={pick}
          min={today}
          onChange={(e) => setPick(e.target.value)}
          className="px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
        />
        <button
          onClick={add}
          type="button"
          className="px-4 py-2.5 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
        >
          Block this date
        </button>
      </div>

      {dates.length === 0 ? (
        <p className="text-sm text-ink-soft">No blocked dates. You&apos;re open for every day.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {dates.map((d) => (
            <span key={d} className="inline-flex items-center gap-1.5 bg-gray-100 rounded-full pl-3 pr-2 py-1 text-[13px]">
              {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })}
              <button onClick={() => remove(d)} aria-label={`Unblock ${d}`} className="text-ink-soft hover:text-foreground">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {message && (
        <div className={`text-sm ${message.ok ? "text-accent" : "text-red-700"}`}>{message.text}</div>
      )}
      <button
        onClick={save}
        disabled={saving}
        className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-70"
      >
        {saving ? "Saving…" : "Save availability"}
      </button>
    </div>
  );
}
