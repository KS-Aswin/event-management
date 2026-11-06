"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VendorDocument } from "@/lib/admin/documents";
import {
  DOC_ACCEPT,
  DOC_STATUS_CLASS,
  DOC_STATUS_LABEL,
  DOC_TYPE_HINT,
  DOC_TYPE_LABEL,
  DOC_TYPES,
  MAX_DOC_BYTES,
  formatDocDate,
  type DocType,
} from "./doc-meta";

type FieldErrors = Partial<Record<"docType" | "file" | "number" | "expiresAt", string>>;

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function uploadedOn(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function DocumentsManager({ initial }: { initial: VendorDocument[] }) {
  const router = useRouter();
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState(initial);
  const [docType, setDocType] = useState<DocType | "">("");
  const [number, setNumber] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setErrors((e) => ({ ...e, file: undefined }));
    if (f && f.size > MAX_DOC_BYTES) setErrors((e) => ({ ...e, file: "This file is larger than 4 MB. Try a smaller scan." }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: FieldErrors = {};
    if (!docType) next.docType = "Choose what kind of document this is.";
    if (!file) next.file = "Choose a PDF, JPEG or PNG file.";
    else if (file.size > MAX_DOC_BYTES) next.file = "This file is larger than 4 MB. Try a smaller scan.";
    setErrors(next);
    setFormError(null);
    setMessage(null);
    if (Object.keys(next).length) return;

    const fd = new FormData();
    fd.set("docType", docType);
    if (number.trim()) fd.set("number", number.trim());
    if (expiresAt) fd.set("expiresAt", expiresAt);
    fd.set("file", file!);
    setBusy(true);
    try {
      const res = await fetch("/api/vendor/documents", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { document?: VendorDocument; error?: string; field?: string };
      if (!res.ok || !data.document) {
        const msg = data.error ?? "Could not upload the document. Please try again.";
        if (data.field && ["docType", "file", "number", "expiresAt"].includes(data.field)) {
          setErrors({ [data.field]: msg } as FieldErrors);
        } else {
          setFormError(msg);
        }
        return;
      }
      setDocs((d) => [data.document!, ...d]);
      setDocType("");
      setNumber("");
      setExpiresAt("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setMessage("Uploaded. We usually check documents within 2 working days.");
      router.refresh();
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: VendorDocument) {
    setDeletingId(doc.id);
    setListError(null);
    try {
      const res = await fetch(`/api/vendor/documents/${doc.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok && res.status !== 404) {
        setListError(data.error ?? "Could not delete the document.");
        return;
      }
      setDocs((d) => d.filter((x) => x.id !== doc.id));
      setConfirmId(null);
      router.refresh();
    } catch {
      setListError("Network error. Check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  const hint = docType ? DOC_TYPE_HINT[docType] : "Pick the type first, then add the file.";
  const errId = (k: keyof FieldErrors) => (errors[k] ? `${uid}-${k}-e` : undefined);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
      <section aria-labelledby={`${uid}-up`} className="card">
        <h2 id={`${uid}-up`} className="text-title font-semibold">
          Upload a document
        </h2>
        <p className="mt-1 text-caption text-ink-soft">PDF, JPEG or PNG, up to 4 MB. A clear phone photo is fine.</p>

        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <div>
            <label htmlFor={`${uid}-type`} className="label">
              Document type <span className="text-danger">*</span>
            </label>
            <select
              id={`${uid}-type`}
              className="field"
              value={docType}
              onChange={(e) => {
                setDocType(e.target.value as DocType | "");
                setErrors((x) => ({ ...x, docType: undefined }));
              }}
              aria-invalid={errors.docType ? true : undefined}
              aria-describedby={errId("docType") ?? `${uid}-type-h`}
              required
            >
              <option value="">Choose…</option>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            {errors.docType ? (
              <p id={errId("docType")} className="mt-1 text-caption text-danger">
                {errors.docType}
              </p>
            ) : (
              <p id={`${uid}-type-h`} className="mt-1 text-caption text-ink-soft">
                {hint}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`${uid}-file`} className="label">
              File <span className="text-danger">*</span>
            </label>
            <input
              ref={fileRef}
              id={`${uid}-file`}
              type="file"
              accept={DOC_ACCEPT}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              aria-invalid={errors.file ? true : undefined}
              aria-describedby={errId("file")}
              className="block w-full min-h-11 text-base text-ink-soft file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-control file:border file:border-line-strong file:bg-surface file:px-4 file:text-sm file:font-medium file:text-foreground hover:file:bg-surface-muted"
            />
            {file && !errors.file ? (
              <p className="mt-1 text-caption text-ink-soft break-all">
                {file.name} · {sizeLabel(file.size)}
              </p>
            ) : null}
            {errors.file ? (
              <p id={errId("file")} className="mt-1 text-caption text-danger">
                {errors.file}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-num`} className="label">
                Number <span className="font-normal text-ink-soft">(optional)</span>
              </label>
              <input
                id={`${uid}-num`}
                className="field"
                value={number}
                onChange={(e) => {
                  setNumber(e.target.value);
                  setErrors((x) => ({ ...x, number: undefined }));
                }}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={errors.number ? true : undefined}
                aria-describedby={errId("number")}
              />
              {errors.number ? (
                <p id={errId("number")} className="mt-1 text-caption text-danger">
                  {errors.number}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor={`${uid}-exp`} className="label">
                Valid until <span className="font-normal text-ink-soft">(optional)</span>
              </label>
              <input
                id={`${uid}-exp`}
                type="date"
                className="field"
                value={expiresAt}
                onChange={(e) => {
                  setExpiresAt(e.target.value);
                  setErrors((x) => ({ ...x, expiresAt: undefined }));
                }}
                aria-invalid={errors.expiresAt ? true : undefined}
                aria-describedby={errId("expiresAt")}
              />
              {errors.expiresAt ? (
                <p id={errId("expiresAt")} className="mt-1 text-caption text-danger">
                  {errors.expiresAt}
                </p>
              ) : null}
            </div>
          </div>

          {formError ? (
            <p role="alert" className="alert-error">
              {formError}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block sm:w-auto" disabled={busy}>
            {busy ? "Uploading…" : "Upload document"}
          </button>
        </form>
      </section>

      <section aria-labelledby={`${uid}-list`} className="min-w-0">
        <h2 id={`${uid}-list`} className="text-title font-semibold">
          Your documents
        </h2>
        <div aria-live="polite">
          {message ? <p className="alert-success mt-3">{message}</p> : null}
          {listError ? (
            <p role="alert" className="alert-error mt-3">
              {listError}
            </p>
          ) : null}
        </div>

        {docs.length === 0 ? (
          <div className="card mt-3">
            <p className="font-medium">No documents yet</p>
            <p className="mt-1 text-body text-ink-soft">
              Customers trust a Verified business more. Upload one registration document to get started.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3" data-testid="vendor-documents">
            {docs.map((d) => {
              const confirming = confirmId === d.id;
              const deleting = deletingId === d.id;
              return (
                <li key={d.id} className="card" data-document-id={d.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{d.typeLabel}</p>
                      <p className="mt-0.5 text-caption text-ink-soft break-words">
                        {[
                          d.number,
                          d.expiresAt ? `valid until ${formatDocDate(d.expiresAt)}` : null,
                          `uploaded ${uploadedOn(d.createdAt)}`,
                          `${d.mime === "application/pdf" ? "PDF" : "Image"}, ${sizeLabel(d.bytes)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 text-xs font-medium leading-6 ${DOC_STATUS_CLASS[d.status]}`}>
                      {DOC_STATUS_LABEL[d.status]}
                    </span>
                  </div>

                  {d.status === "rejected" && d.reason ? (
                    <p className="mt-3 rounded-control bg-danger-tint/60 p-3 text-body">
                      <span className="font-medium text-danger">Reason: </span>
                      {d.reason}
                    </p>
                  ) : null}
                  {d.status === "expired" ? (
                    <p className="mt-3 text-body text-ink-soft">
                      This licence has expired. Your listing stays live; upload the renewed one so your badge stays valid.
                    </p>
                  ) : null}

                  {d.canDelete ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {confirming ? (
                        <>
                          <span className="text-caption text-ink-soft">Delete this document?</span>
                          <button
                            type="button"
                            className="btn btn-sm bg-danger text-white hover:bg-[#8f1f18]"
                            onClick={() => void remove(d)}
                            disabled={deleting}
                          >
                            {deleting ? "Deleting…" : "Yes, delete"}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmId(null)} disabled={deleting}>
                            Keep it
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm text-danger hover:bg-danger-tint"
                          onClick={() => setConfirmId(d.id)}
                          aria-label={`Delete ${d.typeLabel}`}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
