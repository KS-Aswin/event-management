"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "@/app/vendor/_components/offering-api";
import { StepActions } from "./step-actions";
import type { StepProps } from "./types";

// Photos step: logo, cover and portfolio photos through the three-step upload
// API (reserve -> PUT bytes -> complete). Videos, albums and captions live in
// the full media library (/vendor/media).

interface Asset {
  id: number;
  kind: string;
  purpose: string;
  status: string;
  statusReason: string | null;
  caption: string | null;
  urls: { thumb?: string | null; card?: string | null; full?: string | null };
  placeholderColor?: string | null;
}

interface MediaPayload {
  assets: Asset[];
  logoMediaId: number | null;
  coverMediaId: number | null;
  maxImageBytes: number;
}

type Purpose = "logo" | "cover" | "gallery";
type Job = { id: string; name: string; purpose: Purpose; progress: number; error?: string; file: File };

const ACCEPT = "image/jpeg,image/png,image/webp";
const MIN_PHOTOS = 3;

function putFile(url: string, method: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method || "PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (!headers["Content-Type"] && !headers["content-type"]) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ ok: true });
      let error = "Upload failed.";
      try {
        error = JSON.parse(xhr.responseText).error ?? error;
      } catch {
        // not JSON
      }
      resolve({ ok: false, error });
    };
    xhr.onerror = () => resolve({ ok: false, error: "Upload failed. Check your connection." });
    xhr.send(file);
  });
}

export default function StepMedia({ data, setData, next, back }: StepProps) {
  const uid = useId();
  const [media, setMedia] = useState<MediaPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<MediaPayload>("/api/vendor/media");
    if (!r.ok) {
      setLoadError(r.error);
      return;
    }
    setLoadError(null);
    setMedia(r.data);
    const l = await api<Record<string, unknown>>("/api/vendor/listing");
    if (l.ok) setData((d) => ({ ...d, ...(l.data as object) }));
  }, [setData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API (state is set after the fetch)
    void refresh();
  }, [refresh]);

  const setJob = (id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));

  async function run(job: Job) {
    const maxBytes = media?.maxImageBytes ?? 15 * 1024 * 1024;
    if (!ACCEPT.split(",").includes(job.file.type)) {
      return setJob(job.id, { error: "Use a JPEG, PNG or WebP photo (iPhone HEIC: export as JPEG)." });
    }
    if (job.file.size > maxBytes) {
      return setJob(job.id, { error: `This photo is over ${Math.round(maxBytes / 1024 / 1024)} MB.` });
    }
    setJob(job.id, { error: undefined, progress: 1 });
    const res = await api<{ assetId: number; uploadUrl: string; method: string; headers: Record<string, string> }>(
      "/api/vendor/media/uploads",
      "POST",
      { kind: "image", purpose: job.purpose, contentType: job.file.type, bytes: job.file.size }
    );
    if (!res.ok) return setJob(job.id, { error: res.error, progress: 0 });
    const put = await putFile(res.data.uploadUrl, res.data.method, res.data.headers ?? {}, job.file, (p) =>
      setJob(job.id, { progress: Math.max(1, Math.min(p, 95)) })
    );
    if (!put.ok) return setJob(job.id, { error: put.error, progress: 0 });
    const done = await api(`/api/vendor/media/uploads/${res.data.assetId}/complete`, "POST", {});
    if (!done.ok) return setJob(job.id, { error: done.error, progress: 0 });
    setJobs((js) => js.filter((j) => j.id !== job.id));
    await refresh();
  }

  function start(files: FileList | null, purpose: Purpose) {
    setError(null);
    if (!files?.length) return;
    if (!consent) {
      setError("Please confirm you own these photos or have permission to use them.");
      document.getElementById(`${uid}-consent`)?.focus();
      return;
    }
    const list = Array.from(files).slice(0, purpose === "gallery" ? 20 : 1);
    const created = list.map((file, i) => ({ id: `${Date.now()}-${i}`, name: file.name, purpose, progress: 0, file }));
    setJobs((js) => [...js, ...created]);
    // One at a time keeps phones responsive; a failure doesn't stop the rest.
    void (async () => {
      for (const j of created) await run(j);
    })();
  }

  const assets = media?.assets ?? [];
  const gallery = assets.filter((a) => a.kind === "image" && a.purpose === "gallery" && a.status !== "rejected");
  const logo = assets.find((a) => a.id === media?.logoMediaId);
  const cover = assets.find((a) => a.id === media?.coverMediaId);
  const photoCount = data.media?.images ?? gallery.length;
  const enough = photoCount >= MIN_PHOTOS && !!(logo || cover);

  const slot = (purpose: "logo" | "cover", asset: Asset | undefined, label: string, hint: string) => (
    <div className="flex flex-col gap-2">
      <span className="label !mb-0">{label}</span>
      <div
        className={`relative overflow-hidden rounded-card border border-line bg-surface-muted ${
          purpose === "logo" ? "aspect-square w-28" : "aspect-[16/9] w-full"
        }`}
        style={asset?.placeholderColor ? { background: asset.placeholderColor } : undefined}
      >
        {asset?.urls.thumb || asset?.urls.card ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={(purpose === "cover" ? asset.urls.card : asset.urls.thumb) ?? asset.urls.thumb ?? ""} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-caption text-ink-soft px-2 text-center">{hint}</span>
        )}
      </div>
      <label className={`btn btn-secondary btn-sm self-start ${!consent ? "opacity-80" : ""}`}>
        {asset ? `Replace ${purpose}` : `Upload ${purpose}`}
        <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => { start(e.target.files, purpose); e.target.value = ""; }} />
      </label>
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <p className="text-lead text-ink-soft -mt-3">
        Profiles with real photos get far more enquiries. Add a logo or cover and at least {MIN_PHOTOS} photos of your work
        (6 or more is best).
      </p>

      {loadError && (
        <div className="alert-error flex flex-wrap items-center gap-3" role="alert">
          {loadError}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}

      <label className="flex items-start gap-3 cursor-pointer text-sm">
        <input
          id={`${uid}-consent`}
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          These are photos of my own work, and I have permission from the people in them to show them publicly.
        </span>
      </label>

      <section className="grid gap-6 sm:grid-cols-[auto_1fr]" aria-label="Logo and cover">
        {slot("logo", logo, "Logo", "Square, 200 px or more")}
        {slot("cover", cover, "Cover photo", "Wide photo, 1200 × 675 px or more")}
      </section>

      <section aria-labelledby={`${uid}-gal`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${uid}-gal`} className="text-title font-semibold">
            Portfolio photos
          </h2>
          <p className="text-caption text-ink-soft" aria-live="polite">
            {gallery.length} uploaded{gallery.length < MIN_PHOTOS ? ` · ${MIN_PHOTOS - gallery.length} more needed` : ""}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {gallery.map((a) => (
            <figure key={a.id} className="relative aspect-square overflow-hidden rounded-control bg-surface-muted" style={a.placeholderColor ? { background: a.placeholderColor } : undefined}>
              {a.urls.thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.urls.thumb} alt={a.caption || "Portfolio photo"} className="h-full w-full object-cover" />
              )}
              {a.status === "pending_review" && (
                <figcaption className="absolute bottom-1 left-1 chip !text-[11px] bg-white/90">Under review</figcaption>
              )}
            </figure>
          ))}
          <label className="aspect-square rounded-control border-2 border-dashed border-line-strong grid place-items-center text-center text-sm text-accent cursor-pointer hover:bg-accent-tint focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-focus)]">
            <span className="px-2">+ Add photos</span>
            <input
              type="file"
              accept={ACCEPT}
              multiple
              className="sr-only"
              onChange={(e) => {
                start(e.target.files, "gallery");
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </section>

      {jobs.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Uploads">
          {jobs.map((j) => (
            <li key={j.id} className="card !py-3 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="flex-1 min-w-0 truncate text-sm">{j.name}</span>
                {j.error ? (
                  <>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void run(j)}>
                      Retry
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setJobs((js) => js.filter((x) => x.id !== j.id))}
                      aria-label={`Dismiss ${j.name}`}
                    >
                      Dismiss
                    </button>
                  </>
                ) : (
                  <span className="text-caption text-ink-soft">{j.progress ? `${j.progress}%` : "Waiting…"}</span>
                )}
              </div>
              {j.error ? (
                <p className="text-caption text-danger" role="alert">
                  {j.error}
                </p>
              ) : (
                <div className="h-1.5 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={j.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${j.name}`}>
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${j.progress}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-body text-ink-soft">
        Videos (YouTube, Instagram or MP4), albums and captions are in the{" "}
        <Link href="/vendor/media" className="text-accent font-medium hover:underline underline-offset-2">
          media library
        </Link>
        . Your progress here is saved.
      </p>

      <StepActions
        onBack={back}
        onContinue={() => void next()}
        error={error}
        continueLabel={enough ? "Continue" : "Continue for now"}
      />
    </div>
  );
}
