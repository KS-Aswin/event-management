"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ReasonDialog, type ReasonRequest } from "@/app/admin/media/_components/reason-dialog";
import type { ClaimCandidate } from "@/lib/admin/vendors";
import { adminFetch } from "./api";

// P1-11 claim: link an unowned (seeded) listing to a vendor account that has
// no listing yet. Search lists only eligible accounts; the API still answers
// 409 if the account got a listing in the meantime.

export default function AssignOwner({ vendorId, vendorName }: { vendorId: number; vendorName: string }) {
  const router = useRouter();
  const uid = useId();
  const [q, setQ] = useState("");
  // Results remember the search they answer, so a stale answer never shows.
  const [found, setFound] = useState<{ term: string; users: ClaimCandidate[]; error: string | null } | null>(null);
  const [dialog, setDialog] = useState<ReasonRequest | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const term = q.trim();
  const active = term.length >= 2;
  const current = active && found?.term === term ? found : null;
  const results = current ? current.users : null;
  const error = current?.error ?? null;
  const loading = active && !current;
  const setResults = (fn: (l: ClaimCandidate[] | null) => ClaimCandidate[] | null) =>
    setFound((f) => (f ? { ...f, users: fn(f.users) ?? [] } : f));

  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await adminFetch(`/api/admin/vendors/${vendorId}/owner?q=${encodeURIComponent(term)}`, "GET");
      if (!live) return;
      setFound(
        r.ok
          ? { term, users: (r.data.users as ClaimCandidate[]) ?? [], error: null }
          : { term, users: [], error: r.error }
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [term, vendorId]);

  function pick(u: ClaimCandidate) {
    setDialog({
      title: `Give ${vendorName} to ${u.name}?`,
      description: `${u.email} will manage this listing from their vendor home. One account can own only one listing.`,
      confirmLabel: "Assign owner",
      required: false,
      label: "Note for the audit log (optional)",
      onConfirm: async (reason) => {
        const r = await adminFetch(`/api/admin/vendors/${vendorId}/owner`, "POST", { userId: u.id, reason: reason || undefined });
        if (!r.ok) {
          if (r.status === 409) {
            setResults((list) => list?.filter((x) => x.id !== u.id) ?? null);
            router.refresh();
          }
          return r.error;
        }
        setDone(`${u.name} now manages this listing. They'll see it on their vendor home when they sign in.`);
        router.refresh();
        return null;
      },
    });
  }

  if (done) return <p className="alert-success">{done}</p>;

  return (
    <div>
      <label htmlFor={`${uid}-q`} className="label">
        Find a vendor account
      </label>
      <input
        id={`${uid}-q`}
        type="search"
        className="field"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Name, email or phone"
        autoComplete="off"
        aria-describedby={`${uid}-h`}
      />
      <p id={`${uid}-h`} className="hint">
        Only vendor accounts without a listing are shown.
      </p>
      <div aria-live="polite" className="mt-2">
        {error ? (
          <p className="alert-error">{error}</p>
        ) : loading && !results ? (
          <p className="text-caption text-ink-soft">Searching…</p>
        ) : results && results.length === 0 ? (
          <p className="text-body text-ink-soft">No vendor account without a listing matches “{q.trim()}”.</p>
        ) : results ? (
          <ul className="border border-line rounded-card divide-y divide-line overflow-hidden" data-testid="claim-candidates">
            {results.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-medium truncate">{u.name}</span>
                  <span className="block text-caption text-ink-soft truncate">
                    {u.email}
                    {u.phone_e164 ? ` · ${u.phone_e164}` : ""}
                  </span>
                </span>
                <button type="button" className="btn btn-secondary btn-sm min-h-11 shrink-0" onClick={() => pick(u)}>
                  Assign
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ReasonDialog request={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
