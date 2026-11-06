"use client";

// Logo / cover crop (P0-7). The vendor pans (drag, or arrow keys on the
// frame) and zooms (slider, +/- keys, or the buttons) a photo inside a fixed
// square or 16:9 frame; the server cuts that region out with sharp
// (POST /api/vendor/media/crop) and makes it the logo or cover.
//
// State is the zoom (1 = the photo just covers the frame) and the centre of
// the visible area as fractions of the photo, so nothing depends on the
// on-screen size of the frame.

import { useEffect, useId, useRef, useState } from "react";
import type { ClientAsset } from "./media-uploader";

const ASPECT = { logo: 1, cover: 16 / 9 } as const;
const MIN_PX = { logo: 200, cover: 800 } as const;
const MAX_ZOOM = 4;
const STEP = 0.04;

export interface CropResult {
  mediaId: number;
  url: string | null;
  asset: ClientAsset;
}

interface Size {
  w: number;
  h: number;
}

/** Visible fraction of the photo (width, height) at zoom z. */
function visible(img: Size, aspect: number, z: number) {
  const ia = img.w / img.h;
  // At z = 1 the photo covers the frame: one side fits exactly.
  const cw = ia > aspect ? aspect / ia : 1;
  const ch = ia > aspect ? 1 : ia / aspect;
  return { cw: cw / z, ch: ch / z };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function CropDialog({
  which,
  asset,
  onClose,
  onCropped,
}: {
  which: "logo" | "cover";
  asset: ClientAsset;
  onClose: () => void;
  onCropped: (r: CropResult) => void;
}) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const [img, setImg] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const aspect = ASPECT[which];
  const src = asset.urls.source ?? asset.urls.full ?? asset.urls.card;
  const label = which === "logo" ? "logo" : "cover photo";

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Largest zoom that still leaves enough real pixels for a sharp result.
  const maxZoom = img
    ? clamp(Math.min(MAX_ZOOM, (visible(img, aspect, 1).cw * img.w) / MIN_PX[which]), 1, MAX_ZOOM)
    : 1;
  const tooSmall = img ? visible(img, aspect, 1).cw * img.w < MIN_PX[which] - 1 : false;

  function place(nextZoom: number, c = center) {
    if (!img) return;
    const z = clamp(nextZoom, 1, maxZoom);
    const { cw, ch } = visible(img, aspect, z);
    setZoom(z);
    setCenter({ x: clamp(c.x, cw / 2, 1 - cw / 2), y: clamp(c.y, ch / 2, 1 - ch / 2) });
  }

  function nudge(dx: number, dy: number) {
    if (!img) return;
    const { cw, ch } = visible(img, aspect, zoom);
    place(zoom, { x: center.x + dx * cw, y: center.y + dy * ch });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: center.x, cy: center.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const frame = frameRef.current;
    if (!d || !img || !frame) return;
    const { cw, ch } = visible(img, aspect, zoom);
    const rect = frame.getBoundingClientRect();
    // Moving the photo right shows more of its left side.
    place(zoom, {
      x: d.cx - ((e.clientX - d.x) / rect.width) * cw,
      y: d.cy - ((e.clientY - d.y) / rect.height) * ch,
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const map: Record<string, () => void> = {
      ArrowLeft: () => nudge(-STEP, 0),
      ArrowRight: () => nudge(STEP, 0),
      ArrowUp: () => nudge(0, -STEP),
      ArrowDown: () => nudge(0, STEP),
      "+": () => place(zoom + 0.1),
      "=": () => place(zoom + 0.1),
      "-": () => place(zoom - 0.1),
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }

  async function save() {
    if (!img) return;
    const { cw, ch } = visible(img, aspect, zoom);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/vendor/media/crop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          which,
          mediaId: asset.id,
          crop: {
            x: clamp(center.x - cw / 2, 0, 1),
            y: clamp(center.y - ch / 2, 0, 1),
            width: cw,
            height: ch,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Couldn't save the crop. Please try again.");
        return;
      }
      onCropped(data as CropResult);
      onClose();
    } catch {
      setError("You seem to be offline. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  // Photo box inside the frame, in % of the frame.
  let style: React.CSSProperties = {};
  if (img) {
    const { cw, ch } = visible(img, aspect, zoom);
    const W = 1 / cw;
    const H = 1 / ch;
    style = {
      width: `${W * 100}%`,
      height: `${H * 100}%`,
      left: `${(0.5 - center.x * W) * 100}%`,
      top: `${(0.5 - center.y * H) * 100}%`,
    };
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${uid}-t`}
      aria-describedby={`${uid}-d`}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-card bg-surface p-0 text-foreground shadow-pop backdrop:bg-black/45 sm:m-auto sm:max-w-[600px] sm:rounded-card"
    >
      <div className="p-4 sm:p-6 safe-bottom">
        <h2 id={`${uid}-t`} className="font-display text-title font-semibold">
          Crop your {label}
        </h2>
        <p id={`${uid}-d`} className="mt-1 text-body text-ink-soft">
          Drag the photo to choose what shows. Use the slider to zoom.
          <span className="sr-only"> On the photo frame, arrow keys move the photo and plus or minus zoom.</span>
        </p>

        <div
          ref={frameRef}
          role="group"
          aria-roledescription="crop frame"
          aria-label={`${which === "logo" ? "Square" : "Wide 16:9"} crop of the photo. Use arrow keys to move, plus and minus to zoom.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          className={`relative mx-auto mt-4 cursor-grab touch-none select-none overflow-hidden border border-line bg-surface-muted outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 active:cursor-grabbing ${
            which === "logo" ? "aspect-square w-full max-w-[320px] rounded-card" : "aspect-video w-full rounded-control"
          }`}
          data-testid="crop-frame"
        >
          {src && !loadFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- raw <img> so the natural size is known and it can be positioned freely
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setLoadFailed(true)}
              className={`pointer-events-none absolute max-w-none ${img ? "" : "invisible"}`}
              style={style}
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-caption text-ink-soft">
              This photo couldn&apos;t be loaded.
            </span>
          )}
          {/* Rule-of-thirds guide */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="border-[0.5px] border-white/35" />
            ))}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm min-w-11"
            onClick={() => place(zoom - 0.25)}
            disabled={!img || zoom <= 1}
            aria-label="Zoom out"
          >
            −
          </button>
          <label htmlFor={`${uid}-z`} className="sr-only">
            Zoom
          </label>
          <input
            id={`${uid}-z`}
            type="range"
            min={1}
            max={maxZoom}
            step={0.01}
            value={zoom}
            disabled={!img || maxZoom <= 1}
            onChange={(e) => place(Number(e.target.value))}
            className="h-11 flex-1 accent-[var(--color-accent)]"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm min-w-11"
            onClick={() => place(zoom + 0.25)}
            disabled={!img || zoom >= maxZoom}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setZoom(1);
              setCenter({ x: 0.5, y: 0.5 });
            }}
            disabled={!img}
          >
            Reset
          </button>
        </div>

        {tooSmall ? (
          <p className="alert-error mt-3" role="alert">
            This photo is too small for a sharp {label}. Use one at least {MIN_PX[which]} px wide
            {which === "cover" ? " (16:9)" : ""}.
          </p>
        ) : null}
        {error ? (
          <p className="alert-error mt-3" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!img || saving || tooSmall}>
            {saving ? "Saving..." : `Use as ${label}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
