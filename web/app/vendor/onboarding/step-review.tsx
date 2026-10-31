"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, categoryName } from "@/app/vendor/_components/offering-api";
import type { ClientListing } from "@/app/api/vendor/listing/_parse";
import type { StepProps } from "./types";

// Review & submit: a summary, the checklist the server enforces, and Submit
// (-> status pending, "Under review"; not public until an admin approves).

const STEP_FOR: Record<string, number> = { basics: 1, offering: 3, logo_or_cover: 5, images: 5 };
const LABELS: Record<string, string> = {
  basics: "Business basics",
  offering: "A priced offering customers can book",
  logo_or_cover: "Logo or cover photo",
  images: "3 or more photos",
};

export default function StepReview({ tax, data, setData, back }: StepProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const l = data.listing;

  const refresh = useCallback(async () => {
    const r = await api<Record<string, unknown>>("/api/vendor/listing");
    if (r.ok) setData((d) => ({ ...d, ...(r.data as object) }));
  }, [setData]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!l) return null;
  const goStep = (n: number) => window.history.pushState(null, "", `/vendor/onboarding?step=${n}`);

  async function submit() {
    setError(null);
    setBusy(true);
    const r = await api<{ listing: ClientListing }>("/api/vendor/listing/submit", "POST");
    setBusy(false);
    if (!r.ok) {
      if (r.code === "INCOMPLETE") {
        setData((d) => ({
          ...d,
          missing: (r.data.missing as string[]) ?? d.missing,
          missingMessages: (r.data.missingMessages as string[]) ?? d.missingMessages,
        }));
        setError("A few things are still missing. Fix the items marked below, then submit again.");
      } else setError(r.error);
      return;
    }
    setData((d) => ({ ...d, listing: r.data.listing }));
    setSubmitted(true);
  }

  const status = l.status;
  const units = data.offerings.filter((o) => o.kind !== "package" && o.active && !o.needs_price);
  const packages = data.offerings.filter((o) => o.kind === "package" && o.active);
  const area = tax.districts.find((d) => d.id === l.districtId)?.name;
  const previewHref = `/vendors/${l.id}?preview=1`;
  const checks = ["basics", "offering", "logo_or_cover", "images"];

  if (submitted || status === "pending") {
    return (
      <div className="card text-center py-10" role="status">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-accent-tint text-accent grid place-items-center text-xl" aria-hidden>
          ✓
        </div>
        <h2 className="text-title font-semibold">Your listing is under review</h2>
        <p className="text-body text-ink-soft mt-2 max-w-md mx-auto">
          We usually review new listings within 24 hours. It isn&apos;t public yet. You can keep editing anything while
          you wait.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/vendor" className="btn btn-primary">
            Go to my workspace
          </Link>
          <Link href={previewHref} className="btn btn-secondary">
            Preview my profile
          </Link>
        </div>
      </div>
    );
  }

  const canSubmit = ["draft", "changes_requested", "rejected"].includes(status);

  return (
    <div className="flex flex-col gap-6">
      {status === "approved" && (
        <p className="alert-success" role="status">
          Your listing is live. Changes you make are saved straight away.
        </p>
      )}
      {status === "changes_requested" && l.statusReason && (
        <div className="rounded-control bg-[#fdf3d8] text-gold-ink px-4 py-3 text-sm" role="status">
          <p className="font-medium">Our team asked for changes</p>
          <p className="mt-1">{l.statusReason}</p>
        </div>
      )}

      <section className="card" aria-labelledby="sum-h">
        <h2 id="sum-h" className="sr-only">
          Summary
        </h2>
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 shrink-0 rounded-card overflow-hidden bg-accent-tint grid place-items-center text-accent font-semibold text-xl">
            {l.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              l.name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="text-title font-semibold truncate">{l.name}</p>
            <p className="text-body text-ink-soft">
              {categoryName(tax, l.primaryCategoryId)}
              {area ? ` · ${l.location && l.location !== area ? `${l.location}, ` : ""}${area}` : ""}
            </p>
            <p className="text-body mt-1">{l.priceLabel}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-control bg-surface-muted py-2">
            <dt className="text-caption text-ink-soft">Offerings</dt>
            <dd className="font-semibold">{units.length}</dd>
          </div>
          <div className="rounded-control bg-surface-muted py-2">
            <dt className="text-caption text-ink-soft">Packages</dt>
            <dd className="font-semibold">{packages.length}</dd>
          </div>
          <div className="rounded-control bg-surface-muted py-2">
            <dt className="text-caption text-ink-soft">Photos</dt>
            <dd className="font-semibold">{data.media?.images ?? 0}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="chk-h">
        <h2 id="chk-h" className="text-title font-semibold mb-3">
          Before you submit
        </h2>
        <ul className="flex flex-col gap-2">
          {checks.map((c) => {
            const missing = data.missing.includes(c);
            const msg = data.missingMessages[data.missing.indexOf(c)];
            return (
              <li key={c} className="flex items-start gap-3 rounded-control border border-line p-3">
                <span
                  className={`mt-0.5 h-6 w-6 shrink-0 rounded-full grid place-items-center text-xs font-bold ${
                    missing ? "bg-[#fdf3d8] text-gold-ink" : "bg-accent text-white"
                  }`}
                  aria-hidden
                >
                  {missing ? "!" : "✓"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {LABELS[c]}
                    <span className="sr-only">{missing ? ": missing" : ": done"}</span>
                  </p>
                  {missing && msg && <p className="text-caption text-ink-soft">{msg}</p>}
                </div>
                {missing && (
                  <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => goStep(STEP_FOR[c])}>
                    Fix
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-body text-ink-soft">
        <Link href={previewHref} className="text-accent font-medium hover:underline underline-offset-2">
          Preview your profile
        </Link>{" "}
        as customers will see it.
      </p>

      <div className="pt-5 border-t border-line">
        {error && (
          <p className="alert-error mb-4" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button type="button" className="btn btn-secondary" onClick={back} disabled={busy}>
            Back
          </button>
          {canSubmit ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void submit()} disabled={busy}>
              {busy ? "Submitting…" : status === "draft" ? "Submit for review" : "Resubmit for review"}
            </button>
          ) : (
            <Link href="/vendor" className="btn btn-primary btn-lg">
              Go to my workspace
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
