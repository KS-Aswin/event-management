"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, type TaxonomyLite } from "@/app/vendor/_components/offering-api";
import { STEPS, type StepProps, type WizardData } from "./types";
import StepAbout from "./step-about";
import StepOffer from "./step-offer";
import StepPrices from "./step-prices";
import StepAreas from "./step-areas";
import StepMedia from "./step-media";
import StepReview from "./step-review";

// Onboarding wizard shell (PRODUCT_PLAN 7 Vendor, P0-10). One screen per
// step; every step saves to the server, and onboarding_step records how far
// the vendor got so a later login resumes there. The step lives in ?step=N
// (history.pushState keeps client state; Back/Forward work).

function clamp(n: number, max: number) {
  return Math.min(Math.max(Number.isFinite(n) ? n : 1, 1), max);
}

export default function OnboardingWizard({
  tax,
  initial,
  initialStep,
}: {
  tax: TaxonomyLite;
  initial: WizardData;
  initialStep: number;
}) {
  const params = useSearchParams();
  const [data, setDataState] = useState<WizardData>(initial);
  // Latest data for callbacks that run right after a save (before re-render).
  const dataRef = useRef<WizardData>(initial);
  const setData = useCallback((fn: (d: WizardData) => WizardData) => {
    dataRef.current = fn(dataRef.current);
    setDataState(dataRef.current);
  }, []);
  const reached = data.listing ? clamp(data.listing.onboardingStep, 6) : 1;
  const fromUrl = Number(params.get("step"));
  const step = fromUrl ? clamp(fromUrl, Math.max(reached, 1)) : initialStep;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [step]);

  const go = useCallback((n: number) => {
    const url = `/vendor/onboarding?step=${n}`;
    window.history.pushState(null, "", url);
  }, []);

  const saveListing = useCallback<StepProps["saveListing"]>(
    async (body) => {
      const r = await api<Omit<WizardData, "offerings" | "packageItems">>(
        "/api/vendor/listing",
        dataRef.current.listing ? "PATCH" : "POST",
        body
      );
      if (!r.ok) return { ok: false, error: r.error, field: r.field };
      setData((d) => ({ ...d, ...r.data }));
      return { ok: true };
    },
    [setData]
  );

  const next = useCallback(async () => {
    const target = Math.min(step + 1, 6);
    const listing = dataRef.current.listing;
    if (listing && listing.onboardingStep < target) {
      await saveListing({ onboardingStep: target });
    }
    go(target);
  }, [go, saveListing, step]);

  const back = useCallback(() => go(Math.max(step - 1, 1)), [go, step]);

  const props: StepProps = { tax, data, setData, saveListing, next, back };
  const meta = STEPS[step - 1];

  return (
    <main className="page-narrow py-6 sm:py-10 safe-bottom">
      <nav aria-label="Setup steps" className="mb-6">
        <p className="text-caption text-ink-soft mb-2">
          Step {step} of {STEPS.length}
        </p>
        <ol className="grid grid-cols-6 gap-1.5">
          {STEPS.map((s) => {
            const done = s.n < reached || (s.n < step);
            const current = s.n === step;
            const reachable = s.n <= reached && !!data.listing;
            return (
              <li key={s.n} className="min-w-0">
                {reachable && !current ? (
                  <button
                    type="button"
                    onClick={() => go(s.n)}
                    className="group w-full text-left min-h-11 flex flex-col justify-start gap-1.5 rounded-control"
                  >
                    <span className={`block h-1.5 rounded-full ${done ? "bg-accent" : "bg-line"} group-hover:bg-accent-hover`} />
                    <span className="hidden sm:block text-caption text-ink-soft group-hover:text-accent truncate">{s.title}</span>
                    <span className="sr-only sm:hidden">{s.title}</span>
                    <span className="sr-only">{done ? " (done)" : ""}</span>
                  </button>
                ) : (
                  <div className="min-h-11 flex flex-col gap-1.5" aria-current={current ? "step" : undefined}>
                    <span className={`block h-1.5 rounded-full ${current ? "bg-accent" : done ? "bg-accent" : "bg-line"}`} />
                    <span className={`hidden sm:block text-caption truncate ${current ? "text-foreground font-medium" : "text-ink-soft"}`}>
                      {s.title}
                    </span>
                    <span className="sr-only sm:hidden">{s.title}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-heading sm:text-display font-semibold tracking-tight"
      >
        {meta.title}
      </h1>

      <div className="mt-6">
        {step === 1 && <StepAbout {...props} />}
        {step === 2 && <StepOffer {...props} />}
        {step === 3 && <StepPrices {...props} />}
        {step === 4 && <StepAreas {...props} />}
        {step === 5 && <StepMedia {...props} />}
        {step === 6 && <StepReview {...props} />}
      </div>
    </main>
  );
}
