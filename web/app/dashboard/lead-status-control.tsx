"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_OPTIONS = ["pending", "responded", "booked", "declined"] as const;

export default function LeadStatusControl({
  quoteId,
  status,
}: {
  quoteId: number;
  status: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [saving, setSaving] = useState(false);

  async function handleChange(newStatus: string) {
    const previous = current;
    setCurrent(newStatus); // optimistic
    setSaving(true);
    const res = await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setSaving(false);
    if (!res.ok) {
      setCurrent(previous); // roll back on failure
      return;
    }
    router.refresh();
  }

  return (
    <select
      value={current}
      disabled={saving}
      onChange={(e) => handleChange(e.target.value)}
      className="text-xs border border-line rounded-md px-1.5 py-1 bg-white disabled:opacity-60"
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
