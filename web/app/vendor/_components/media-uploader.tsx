"use client";

// Reusable media uploader (P0-7, PRODUCT_PLAN 4.2 / 4.4). Used by
// /vendor/media and meant to be embedded by the onboarding wizard's
// "Photos & videos" step:
//
//   import MediaUploader from "@/app/vendor/_components/media-uploader";
//   <MediaUploader purpose="gallery" onUploaded={(asset) => ...} />
//   <MediaUploader purpose="logo" label="Upload logo" single onUploaded={...} />
//
// Flow per file (one at a time; a failed file never blocks the next):
//   1. images are downscaled in the browser to a 2560 px long edge (JPEG q0.85)
//      when larger, MP4s get their duration read and a poster frame captured;
//   2. POST /api/vendor/media/uploads reserves the row;
//   3. PUT the bytes to the returned uploadUrl (XHR, so we get progress);
//   4. POST .../complete validates on the server and returns the asset.
// Failures show the server's message and a Retry button.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ClientAsset } from "@/lib/media/repo";

export type { ClientAsset };

export type UploadPurpose = "gallery" | "logo" | "cover";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_EDGE = 2560;
const RESIZE_OVER_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 90;

export class UploadError extends Error {
  retryable: boolean;
  code?: string;
  constructor(message: string, retryable = true, code?: string) {
    super(message);
    this.retryable = retryable;
    this.code = code;
  }
}

async function readError(res: Response): Promise<UploadError> {
  let body: { error?: string; code?: string; limit?: number | string } = {};
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const fallback =
    res.status === 413
      ? "This file is too large."
      : res.status >= 500
        ? "The server had a problem saving this file."
        : `Upload failed (${res.status}).`;
  // 4xx other than timeouts/rate limits won't succeed on a plain retry.
  const retryable = res.status >= 500 || res.status === 408 || res.status === 429 || res.status === 409;
  return new UploadError(body.error || fallback, retryable, body.code);
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new UploadError("This image could not be read. Try a JPEG, PNG or WebP file.", false));
    };
    img.src = url;
  });
}

/** Downscale to MAX_EDGE (JPEG q0.85) when the photo is big; small files go as they are. */
export async function prepareImage(file: File): Promise<Blob> {
  const img = await loadImage(file);
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  if (long <= MAX_EDGE && file.size <= RESIZE_OVER_BYTES) return file;
  const scale = Math.min(1, MAX_EDGE / long);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  return blob && blob.size < file.size ? blob : file;
}

/** Duration plus a JPEG poster frame (null when the browser can't decode it). */
async function inspectVideo(file: File): Promise<{ duration: number | null; poster: Blob | null }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("metadata"));
      setTimeout(() => reject(new Error("timeout")), 8000);
    });
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    let poster: Blob | null = null;
    try {
      video.currentTime = Math.min(1, (duration ?? 2) / 3);
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        setTimeout(() => reject(new Error("seek")), 5000);
      });
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        const scale = Math.min(1, 1280 / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        poster = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
      }
    } catch {
      poster = null;
    }
    return { duration, poster };
  } catch {
    return { duration: null, poster: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function putWithProgress(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method || "PUT", url);
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);
    if (!headers || !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      xhr.setRequestHeader("Content-Type", body.type || "application/octet-stream");
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Upload failed (${xhr.status}).`;
      let code: string | undefined;
      try {
        const b = JSON.parse(xhr.responseText);
        msg = b.error || msg;
        code = b.code;
      } catch {
        /* not JSON */
      }
      reject(new UploadError(msg, xhr.status >= 500 || xhr.status === 409, code));
    };
    xhr.onerror = () => reject(new UploadError("Network problem. Check your connection and retry.", true));
    xhr.onabort = () => reject(new UploadError("Upload cancelled.", true));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

async function sendBlob(
  blob: Blob,
  meta: {
    kind: "image" | "video_file";
    purpose: UploadPurpose | "poster";
    albumId?: number | null;
    durationS?: number | null;
    posterMediaId?: number | null;
  },
  onProgress: (f: number) => void
): Promise<{ asset: ClientAsset; duplicate: boolean }> {
  const reserve = await fetch("/api/vendor/media/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: meta.kind,
      purpose: meta.purpose,
      contentType: blob.type || (meta.kind === "video_file" ? "video/mp4" : "image/jpeg"),
      bytes: blob.size,
      albumId: meta.albumId ?? undefined,
      durationS: meta.durationS ?? undefined,
    }),
  });
  if (!reserve.ok) throw await readError(reserve);
  const r = (await reserve.json()) as { assetId: number; uploadUrl: string; method: string; headers: Record<string, string> };
  await putWithProgress(r.uploadUrl, r.method, r.headers, blob, onProgress);
  const done = await fetch(`/api/vendor/media/uploads/${r.assetId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta.posterMediaId ? { posterMediaId: meta.posterMediaId } : {}),
  });
  if (!done.ok) throw await readError(done);
  return (await done.json()) as { asset: ClientAsset; duplicate: boolean };
}

/** Uploads one File end to end. Throws UploadError with a user-facing message. */
export async function uploadMediaFile(
  file: File,
  opts: { purpose: UploadPurpose; albumId?: number | null; videosEnabled?: boolean },
  onProgress: (fraction: number, stage: string) => void
): Promise<{ asset: ClientAsset; duplicate: boolean }> {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (type === "image/heic" || type === "image/heif" || /\.(heic|heif)$/.test(name)) {
    throw new UploadError("Please upload JPEG. On iPhone choose Most Compatible.", false, "UNSUPPORTED_TYPE");
  }
  if (/\.(cr2|cr3|nef|arw|dng|raf|orf|rw2)$/.test(name)) {
    throw new UploadError("RAW camera files aren't supported. Export a JPEG first.", false, "UNSUPPORTED_TYPE");
  }

  if (type === "video/mp4" || name.endsWith(".mp4")) {
    if (opts.purpose !== "gallery") throw new UploadError("Choose a photo here, not a video.", false);
    if (!opts.videosEnabled) {
      throw new UploadError("Video uploads are off. Add a YouTube, Instagram or Vimeo link instead.", false, "FORBIDDEN");
    }
    onProgress(0, "Reading video");
    const { duration, poster } = await inspectVideo(file);
    if (duration !== null && duration > MAX_VIDEO_SECONDS + 0.5) {
      throw new UploadError(`Videos can be at most ${MAX_VIDEO_SECONDS} seconds. This one is ${Math.round(duration)} s.`, false);
    }
    let posterId: number | null = null;
    if (poster) {
      try {
        const p = await sendBlob(poster, { kind: "image", purpose: "poster" }, () => {});
        posterId = p.asset.id;
      } catch {
        posterId = null; // a branded placeholder is shown instead
      }
    }
    const video = file.type ? file : new File([file], file.name, { type: "video/mp4" });
    return sendBlob(
      video,
      { kind: "video_file", purpose: "gallery", albumId: opts.albumId, durationS: duration, posterMediaId: posterId },
      (f) => onProgress(f, "Uploading")
    );
  }

  if (!IMAGE_TYPES.includes(type)) {
    throw new UploadError("Use a JPEG, PNG or WebP photo.", false, "UNSUPPORTED_TYPE");
  }
  onProgress(0, "Preparing");
  const blob = await prepareImage(file);
  return sendBlob(blob, { kind: "image", purpose: opts.purpose, albumId: opts.albumId }, (f) =>
    onProgress(f, f >= 1 ? "Processing" : "Uploading")
  );
}

// ---------------------------------------------------------------------------
// Queue hook + component
// ---------------------------------------------------------------------------

export interface QueueItem {
  key: string;
  file: File;
  name: string;
  state: "queued" | "working" | "done" | "error";
  stage: string;
  progress: number;
  error?: string;
  retryable?: boolean;
  duplicate?: boolean;
}

export function useUploadQueue(opts: {
  purpose: UploadPurpose;
  albumId?: number | null;
  videosEnabled?: boolean;
  onUploaded?: (asset: ClientAsset, duplicate: boolean) => void;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  // Mirror of `items` the async pump can read without waiting for a render.
  const itemsRef = useRef<QueueItem[]>([]);
  const running = useRef(false);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const update = useCallback((fn: (list: QueueItem[]) => QueueItem[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);
  const patch = useCallback(
    (key: string, p: Partial<QueueItem>) => update((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i))),
    [update]
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const item = itemsRef.current.find((i) => i.state === "queued");
        if (!item) break;
        patch(item.key, { state: "working", progress: 0, stage: "Starting", error: undefined });
        try {
          const o = optsRef.current;
          const res = await uploadMediaFile(
            item.file,
            { purpose: o.purpose, albumId: o.albumId, videosEnabled: o.videosEnabled },
            (progress, stage) => patch(item.key, { progress, stage })
          );
          patch(item.key, {
            state: "done",
            progress: 1,
            stage: res.duplicate ? "Already in your gallery" : "Uploaded",
            duplicate: res.duplicate,
          });
          o.onUploaded?.(res.asset, res.duplicate);
        } catch (err) {
          const e = err instanceof UploadError ? err : new UploadError("Something went wrong. Please retry.", true);
          patch(item.key, { state: "error", error: e.message, retryable: e.retryable });
        }
      }
    } finally {
      running.current = false;
    }
  }, [patch]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const stamp = Date.now();
      const list: QueueItem[] = Array.from(files).map((file, n) => ({
        key: `${stamp}-${n}-${file.name}-${file.size}`,
        file,
        name: file.name,
        state: "queued",
        stage: "Waiting",
        progress: 0,
      }));
      if (!list.length) return;
      update((cur) => [...cur.filter((i) => i.state !== "done"), ...list]);
      void pump();
    },
    [pump, update]
  );

  const retry = useCallback(
    (key: string) => {
      patch(key, { state: "queued", stage: "Waiting", progress: 0, error: undefined });
      void pump();
    },
    [patch, pump]
  );

  const dismiss = useCallback((key: string) => update((list) => list.filter((i) => i.key !== key)), [update]);
  const clearDone = useCallback(() => update((list) => list.filter((i) => i.state !== "done")), [update]);
  const busy = items.some((i) => i.state === "queued" || i.state === "working");

  return { items, add, retry, dismiss, clearDone, busy };
}

export function UploadList({
  items,
  onRetry,
  onDismiss,
}: {
  items: QueueItem[];
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-2" aria-label="Uploads">
      {items.map((i) => (
        <li
          key={i.key}
          className={`rounded-control border px-3 py-2.5 ${i.state === "error" ? "border-danger/40 bg-danger-tint" : "border-line bg-surface"}`}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{i.name}</div>
              <div className={`text-caption ${i.state === "error" ? "text-danger" : "text-ink-soft"}`} role={i.state === "error" ? "alert" : undefined}>
                {i.state === "error" ? i.error : i.state === "working" ? `${i.stage}… ${Math.round(i.progress * 100)}%` : i.stage}
              </div>
            </div>
            {i.state === "error" ? (
              <div className="flex shrink-0 gap-1.5">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRetry(i.key)}>
                  Retry
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm px-2.5"
                  onClick={() => onDismiss(i.key)}
                  aria-label={`Dismiss ${i.name}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : i.state === "done" ? (
              <svg className="shrink-0 text-accent" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Uploaded">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : null}
          </div>
          {i.state === "working" || i.state === "queued" ? (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted"
              role="progressbar"
              aria-label={`Uploading ${i.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(i.progress * 100)}
            >
              <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(3, i.progress * 100)}%` }} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Drop zone + file picker + consent checkbox + per-file progress list.
 * `consent` (gallery default true) requires the "I have permission" tick
 * before files can be chosen.
 */
export default function MediaUploader({
  purpose = "gallery",
  albumId = null,
  videosEnabled = false,
  single = false,
  consent = purpose === "gallery",
  label,
  hint,
  disabled = false,
  disabledReason,
  onUploaded,
  onConsent,
  compact = false,
  buttonClassName = "btn btn-secondary btn-sm",
}: {
  purpose?: UploadPurpose;
  albumId?: number | null;
  videosEnabled?: boolean;
  single?: boolean;
  consent?: boolean;
  label?: string;
  hint?: string;
  disabled?: boolean;
  disabledReason?: string;
  onUploaded?: (asset: ClientAsset, duplicate: boolean) => void;
  /** Called once when the vendor ticks the consent box (e.g. to save it on the album). */
  onConsent?: () => void;
  /** Just a button + progress list (no drop zone, no consent box): logo/cover slots. */
  compact?: boolean;
  buttonClassName?: string;
}) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [agreed, setAgreed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const queue = useUploadQueue({ purpose, albumId, videosEnabled, onUploaded });
  const blocked = disabled || (consent && !agreed);
  const accept = `image/jpeg,image/png,image/webp${videosEnabled && purpose === "gallery" ? ",video/mp4" : ""}`;
  const title =
    label ?? (purpose === "logo" ? "Upload logo" : purpose === "cover" ? "Upload cover photo" : videosEnabled ? "Add photos or MP4 videos" : "Add photos");
  const help =
    hint ??
    (purpose === "logo"
      ? "Square, at least 200 × 200 px. JPEG, PNG or WebP."
      : purpose === "cover"
        ? "Wide (16:9), at least 1200 × 675 px."
        : `JPEG, PNG or WebP up to 15 MB${videosEnabled ? "; MP4 up to 50 MB and 90 seconds" : ""}. Large photos are resized before upload.`);

  if (compact) {
    return (
      <div className="min-w-0 max-w-full">
        <button type="button" className={buttonClassName} disabled={disabled || queue.busy} onClick={() => inputRef.current?.click()}>
          {queue.busy ? "Uploading…" : title}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={!single}
          className="sr-only"
          tabIndex={-1}
          aria-label={title}
          data-testid={`media-input-${purpose}`}
          onChange={(e) => {
            if (e.target.files) queue.add(single ? Array.from(e.target.files).slice(0, 1) : e.target.files);
            e.target.value = "";
          }}
        />
        <UploadList items={queue.items} onRetry={queue.retry} onDismiss={queue.dismiss} />
      </div>
    );
  }

  return (
    <div>
      {consent ? (
        <label htmlFor={`${uid}-consent`} className="mb-3 flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input
            id={`${uid}-consent`}
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (e.target.checked) onConsent?.();
            }}
          />
          <span>I have my clients&apos; permission to publish these photos and videos.</span>
        </label>
      ) : null}

      <div
        onDragOver={(e) => {
          if (blocked) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (blocked) return;
          const files = Array.from(e.dataTransfer.files);
          queue.add(single ? files.slice(0, 1) : files);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragOver ? "border-accent bg-accent-tint" : "border-line-strong bg-surface-muted"
        } ${blocked ? "opacity-70" : ""}`}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <circle cx="9" cy="10" r="1.8" />
          <path d="m21 16-5-5-8 8" />
        </svg>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={blocked}
          onClick={() => inputRef.current?.click()}
          aria-describedby={`${uid}-help`}
        >
          {title}
        </button>
        <p id={`${uid}-help`} className="max-w-[46ch] text-caption text-ink-soft">
          {disabled && disabledReason ? disabledReason : consent && !agreed ? "Tick the permission box above to start." : help}
          <span className="hidden sm:inline">{!blocked ? " You can also drop files here." : ""}</span>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={!single}
          className="sr-only"
          tabIndex={-1}
          aria-label={title}
          data-testid={`media-input-${purpose}`}
          disabled={blocked}
          onChange={(e) => {
            if (e.target.files) queue.add(single ? Array.from(e.target.files).slice(0, 1) : e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <UploadList items={queue.items} onRetry={queue.retry} onDismiss={queue.dismiss} />
    </div>
  );
}
