"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminDocument } from "@/lib/admin/documents";
import { AdminEmptyState } from "@/app/admin/_components/admin-page";
import { postAdmin } from "@/app/admin/media/_components/reason-dialog";
import { DOC_STATUS_CLASS, DOC_STATUS_LABEL, formatDocDate, type DocTab } from "@/app/vendor/documents/doc-meta";

const EMPTY: Record<DocTab, { title: string; body: string }> = {
  pending: { title: "Nothing to verify", body: "New business documents from vendors show up here." },
  verified: { title: "No verified documents", body: "Documents you verify are listed here." },
  rejected: { title: "No rejected documents", body: "Documents you reject are listed here with your reason." },
  expired: { title: "Nothing expired", body: "Verified licences past their expiry date show up here." },
};

const REJECT_PRESETS = [
  "File is unreadable or cut off",
  "Name doesn't match the business",
  "Licence has expired",
  "Wrong document type",
];

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export default function DocumentQueueList({ tab, items: initial }: { tab: DocTab; items: AdminDocument[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<AdminDocument | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function done(doc: AdminDocument, text: string, ok: boolean) {
    setItems((list) => list.filter((x) => x.id !== doc.id));
    setMessage({ kind: ok ? "ok" : "error", text });
    router.refresh();
  }

  return (
    <>
      <div aria-live="polite">
        {message ? (
          <div className={`${message.kind === "ok" ? "alert-success" : "alert-error"} mb-4 flex items-start justify-between gap-3`}>
            <span>{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="min-h-11 shrink-0 font-medium underline underline-offset-2 sm:min-h-0">
              Dismiss
            </button>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <AdminEmptyState title={EMPTY[tab].title} body={EMPTY[tab].body} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" data-testid="document-queue">
          {items.map((d) => (
            <li key={d.id} className="card flex min-w-0 flex-col" data-document-id={d.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{d.typeLabel}</p>
                  <Link
                    href={`/admin/vendors/${d.vendor.id}`}
                    // QA-110: a 44px-tall tap target at 390.
                    className="flex min-h-11 min-w-0 items-center text-body text-ink-soft hover:text-foreground hover:underline"
                  >
                    <span className="truncate">{d.vendor.name}</span>
                  </Link>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 text-xs font-medium leading-6 ${DOC_STATUS_CLASS[d.status]}`}>
                  {d.status === "pending" ? "Pending" : DOC_STATUS_LABEL[d.status]}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
                <dt className="text-ink-soft">Number</dt>
                <dd className="min-w-0 break-words font-mono">{d.number ?? "Not given"}</dd>
                <dt className="text-ink-soft">Valid until</dt>
                <dd className={d.expiresAt && d.expiresAt < todayIst() ? "text-danger" : undefined}>
                  {d.expiresAt ? formatDocDate(d.expiresAt) : "No expiry"}
                </dd>
                <dt className="text-ink-soft">Uploaded</dt>
                <dd>{when(d.createdAt)}</dd>
                {d.reviewedAt ? (
                  <>
                    <dt className="text-ink-soft">Reviewed</dt>
                    <dd>
                      {when(d.reviewedAt)}
                      {d.reviewer ? ` by ${d.reviewer}` : ""}
                    </dd>
                  </>
                ) : null}
              </dl>
              {d.storedStatus === "rejected" && d.note ? (
                <p className="mt-3 rounded-control bg-danger-tint/60 p-2.5 text-caption">
                  <span className="font-semibold text-danger">Reason: </span>
                  {d.note}
                </p>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(d)}>
                  {tab === "pending" ? "Review" : "Open"}
                </button>
                <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                  Open file in new tab
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ReviewDialog doc={open} onClose={() => setOpen(null)} onDone={done} />
    </>
  );
}

function ReviewDialog({
  doc,
  onClose,
  onDone,
}: {
  doc: AdminDocument | null;
  onClose: () => void;
  onDone: (doc: AdminDocument, text: string, ok: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (doc && !el.open) el.showModal();
    else if (!doc && el.open) el.close();
  }, [doc]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${uid}-t`}
      className="m-0 mt-auto max-h-[94dvh] w-full max-w-none overflow-y-auto rounded-t-card bg-surface p-0 text-foreground shadow-pop backdrop:bg-black/45 sm:m-auto sm:max-w-[960px] sm:rounded-card"
    >
      {doc ? <ReviewBody key={doc.id} uid={uid} doc={doc} onClose={onClose} onDone={onDone} /> : null}
    </dialog>
  );
}

function ReviewBody({
  uid,
  doc,
  onClose,
  onDone,
}: {
  uid: string;
  doc: AdminDocument;
  onClose: () => void;
  onDone: (doc: AdminDocument, text: string, ok: boolean) => void;
}) {
  const canVerify = doc.storedStatus !== "verified" || doc.status === "expired";
  const canReject = doc.storedStatus !== "rejected";
  const [action, setAction] = useState<"verify" | "reject">(canVerify ? "verify" : "reject");
  const [expiresAt, setExpiresAt] = useState(doc.expiresAt && doc.status !== "expired" ? doc.expiresAt : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<{ field?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const isImage = doc.mime.startsWith("image/");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (action === "reject" && reason.trim().length < 3) {
      setError({ field: "reason", text: "Please give the vendor a reason (3 characters or more)." });
      return;
    }
    if (action === "verify" && expiresAt && expiresAt < todayIst()) {
      setError({ field: "expiresAt", text: "That date has passed. Enter the renewed expiry date or reject the document." });
      return;
    }
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> =
      action === "verify" ? { action, expiresAt: expiresAt || null } : { action, reason: reason.trim() };
    const r = await postAdmin(`/api/admin/documents/${doc.id}/decision`, body);
    setBusy(false);
    if (r.ok) {
      onDone(doc, `${doc.vendor.name}: ${doc.typeLabel} ${action === "verify" ? "verified" : "rejected"}. The vendor was notified.`, true);
      onClose();
    } else if (r.status === 409 || r.status === 404) {
      onDone(doc, `${r.error} The list has been refreshed.`, false);
      onClose();
    } else {
      setError({ text: r.error });
    }
  }

  return (
    <div className="grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-h-56 items-center justify-center bg-surface-muted p-3 md:min-h-[520px]">
        {isImage && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- private admin-only file, not optimisable
          <img
            src={doc.fileUrl}
            alt={`${doc.typeLabel} uploaded by ${doc.vendor.name}`}
            className="max-h-[60dvh] w-auto max-w-full rounded-control object-contain md:max-h-[75dvh]"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="p-6 text-center">
            <p className="font-medium">{isImage ? "The image could not be shown here." : "PDF document"}</p>
            <p className="mt-1 text-caption text-ink-soft">Opens in a new tab through the admin-only file link.</p>
            <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary mt-4">
              Open {isImage ? "image" : "PDF"}
            </a>
          </div>
        )}
      </div>

      <form onSubmit={submit} noValidate className="flex flex-col p-4 sm:p-6 safe-bottom">
        <h2 id={`${uid}-t`} className="font-display text-title font-semibold">
          {doc.typeLabel}
        </h2>
        <p className="mt-0.5 text-body text-ink-soft">
          <Link href={`/admin/vendors/${doc.vendor.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
            {doc.vendor.name}
          </Link>
          {doc.vendor.district ? ` · ${doc.vendor.district}` : ""}
          {doc.vendor.isVerified ? " · Verified business" : ""}
        </p>
        <p className="mt-2 text-caption text-ink-soft">
          {[doc.number ? `No. ${doc.number}` : "No number given", doc.expiresAt ? `valid until ${formatDocDate(doc.expiresAt)}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {canVerify && canReject ? (
          <fieldset className="mt-5">
            <legend className="label">Decision</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["verify", "reject"] as const).map((a) => (
                <label
                  key={a}
                  className={`flex min-h-11 cursor-pointer items-center justify-center rounded-control border px-3 text-sm font-medium transition-colors ${
                    action === a
                      ? a === "verify"
                        ? "border-accent bg-accent-tint text-accent-hover"
                        : "border-danger bg-danger-tint text-danger"
                      : "border-line-strong hover:bg-surface-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${uid}-action`}
                    value={a}
                    checked={action === a}
                    onChange={() => {
                      setAction(a);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  {a === "verify" ? "Verify" : "Reject"}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {action === "verify" ? (
          <div className="mt-4">
            <label htmlFor={`${uid}-exp`} className="label">
              Valid until <span className="font-normal text-ink-soft">(leave empty if it doesn&apos;t expire)</span>
            </label>
            <input
              id={`${uid}-exp`}
              type="date"
              className="field"
              value={expiresAt}
              min={todayIst()}
              onChange={(e) => setExpiresAt(e.target.value)}
              aria-invalid={error?.field === "expiresAt" ? true : undefined}
            />
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Common reasons">
              {REJECT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setReason(p)}
                  aria-pressed={reason === p}
                  className={`min-h-11 rounded-full border px-3 text-sm transition-colors sm:min-h-9 ${
                    reason === p ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong bg-surface hover:bg-surface-muted"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <label htmlFor={`${uid}-r`} className="label mt-3">
              Reason for the vendor <span className="text-danger">*</span>
            </label>
            <textarea
              id={`${uid}-r`}
              className="field"
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={error?.field === "reason" ? true : undefined}
              required
            />
          </div>
        )}

        {error ? (
          <p role="alert" className="alert-error mt-3">
            {error.text}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end md:mt-auto md:pt-6">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Close
          </button>
          {canVerify || canReject ? (
            <button
              type="submit"
              disabled={busy}
              className={`btn ${action === "reject" ? "bg-danger text-white hover:bg-[#8f1f18]" : "btn-primary"}`}
            >
              {busy ? "Saving…" : action === "verify" ? "Verify document" : "Reject document"}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
