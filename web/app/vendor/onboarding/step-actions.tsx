"use client";

/** Back / Continue row shared by the steps. */
export function StepActions({
  onBack,
  busy,
  continueLabel = "Save & continue",
  error,
  onContinue,
}: {
  onBack?: () => void;
  busy?: boolean;
  continueLabel?: string;
  error?: string | null;
  /** When omitted the Continue button submits the surrounding form. */
  onContinue?: () => void;
}) {
  return (
    <div className="mt-8 pt-5 border-t border-line">
      {error && (
        <p className="alert-error mb-4" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {onBack ? (
          <button type="button" className="btn btn-secondary" onClick={onBack} disabled={busy}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button
          type={onContinue ? "button" : "submit"}
          className="btn btn-primary btn-lg"
          disabled={busy}
          onClick={onContinue}
        >
          {busy ? "Saving…" : continueLabel}
        </button>
      </div>
    </div>
  );
}
