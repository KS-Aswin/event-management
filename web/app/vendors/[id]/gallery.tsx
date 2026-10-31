"use client";

// Public profile gallery (PRODUCT_PLAN 4.6): "All photos" / album chips /
// "Videos", a lightbox (arrow keys, swipe, Esc closes) and click-to-load
// video embeds. Data comes pre-filtered from profile-data.ts: the anonymous
// page only ever receives approved items.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { GalleryAlbum, GalleryItem } from "./profile-data";

type Tab = { kind: "all" } | { kind: "album"; id: number } | { kind: "videos" };

function PendingBadge() {
  return (
    <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-gold-ink/95 px-2 py-0.5 text-[11px] font-medium text-white shadow-card">
      Under review
    </span>
  );
}

function PlayIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

const PROVIDER_LABEL: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", vimeo: "Vimeo" };

function VideoCard({ item, vendorName }: { item: GalleryItem; vendorName: string }) {
  const [playing, setPlaying] = useState(false);
  const label = item.caption || `${vendorName} video`;

  if (item.kind === "video_file" && item.video) {
    return (
      <figure className="relative">
        {item.pending ? <PendingBadge /> : null}
        <video
          controls
          preload="none"
          playsInline
          poster={item.poster ?? undefined}
          className="aspect-video w-full rounded-control bg-[#1f2328] object-contain"
          aria-label={label}
        >
          <source src={item.video} type="video/mp4" />
        </video>
        {item.caption ? <figcaption className="mt-1.5 text-caption text-ink-soft">{item.caption}</figcaption> : null}
      </figure>
    );
  }

  const provider = item.provider ? PROVIDER_LABEL[item.provider] : "video";
  return (
    <figure className="relative">
      {item.pending ? <PendingBadge /> : null}
      <div className="relative aspect-video w-full overflow-hidden rounded-control bg-[#1f2328]">
        {playing && item.embedUrl ? (
          <iframe
            src={`${item.embedUrl}${item.embedUrl.includes("?") ? "&" : "?"}autoplay=1`}
            title={label}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : item.embedUrl ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 flex h-full w-full items-center justify-center text-white"
            aria-label={`Play ${label} (loads ${provider})`}
          >
            {item.thumb ? (
              <Image src={item.thumb} alt="" fill unoptimized sizes="(min-width: 640px) 50vw, 100vw" className="object-cover opacity-90 transition-opacity group-hover:opacity-100" />
            ) : (
              <span
                aria-hidden="true"
                className="absolute inset-0"
                style={{ background: "radial-gradient(120% 90% at 20% 0%, rgba(255,255,255,.14), rgba(255,255,255,0) 55%), linear-gradient(135deg,#0f6d52,#123b30)" }}
              />
            )}
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-black/60 pl-1 shadow-pop transition-transform group-hover:scale-105">
              <PlayIcon size={26} />
            </span>
            <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium">{provider}</span>
          </button>
        ) : null}
      </div>
      <figcaption className="mt-1.5 flex items-start justify-between gap-3 text-caption text-ink-soft">
        <span className="min-w-0">{item.caption}</span>
        {item.externalUrl ? (
          <a href={item.externalUrl} target="_blank" rel="noopener noreferrer nofollow" className="shrink-0 font-medium text-accent hover:underline">
            Watch on {provider}
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}

const REPORT_REASONS = ["Not this vendor's work", "Inappropriate or offensive", "Copyright or privacy problem", "Spam or misleading"];

/** "Report photo" form inside the lightbox (POST /api/media/[id]/report). */
function ReportPhoto({ mediaId, onDone }: { mediaId: number; onDone: () => void }) {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "signin" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const text = details.trim() ? `${reason}: ${details.trim()}` : reason;
    try {
      const res = await fetch(`/api/media/${mediaId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: text.slice(0, 500) }),
      });
      if (res.status === 401) return setState("signin");
      if (res.ok || res.status === 409) return setState("sent");
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not send the report. Please try again.");
      setState("error");
    } catch {
      setError("Network error. Please try again.");
      setState("error");
    }
  }

  const next = typeof window !== "undefined" ? window.location.pathname : "/";
  return (
    <div className="mx-auto w-full max-w-md rounded-card bg-[#1f2328] p-4 text-left text-white shadow-pop">
      {state === "sent" ? (
        <div role="status">
          <p className="font-medium">Thanks, we&apos;ll take a look.</p>
          <p className="mt-1 text-sm text-white/75">Our team checks reported photos and removes anything that breaks the content policy.</p>
          <button type="button" onClick={onDone} className="btn btn-sm mt-3 border-white/20 bg-white/10 text-white">
            Close
          </button>
        </div>
      ) : state === "signin" ? (
        <div role="status">
          <p className="font-medium">Sign in to report a photo</p>
          <p className="mt-1 text-sm text-white/75">This helps us stop fake reports.</p>
          <div className="mt-3 flex gap-2">
            <a href={`/login?next=${encodeURIComponent(next)}`} className="btn btn-sm btn-primary">
              Sign in
            </a>
            <button type="button" onClick={onDone} className="btn btn-sm border-white/20 bg-white/10 text-white">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset>
            <legend className="font-medium">What&apos;s wrong with this photo?</legend>
            <div className="mt-2 grid gap-1">
              {REPORT_REASONS.map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-white/5">
                  <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="h-4 w-4 accent-[#0f6d52]" />
                  <span className="text-sm">{r}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor={`report-details-${mediaId}`} className="mt-2 block text-sm text-white/80">
            Details (optional)
          </label>
          <textarea
            id={`report-details-${mediaId}`}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={400}
            rows={2}
            className="mt-1 w-full rounded-control border border-white/20 bg-black/30 p-2 text-[16px] text-white placeholder:text-white/40"
          />
          {error ? (
            <p role="alert" className="mt-2 text-sm text-[#f6b8b3]">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={state === "sending"} className="btn btn-sm btn-primary">
              {state === "sending" ? "Sending..." : "Send report"}
            </button>
            <button type="button" onClick={onDone} className="btn btn-sm border-white/20 bg-white/10 text-white">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Lightbox({
  items,
  index,
  onIndex,
  onClose,
  vendorName,
}: {
  items: GalleryItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  vendorName: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const item = items[index];
  const n = items.length;
  const [reporting, setReporting] = useState<number | null>(null);
  const go = useCallback(
    (d: number) => {
      setReporting(null);
      onIndex((index + d + n) % n);
    },
    [index, n, onIndex]
  );

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Preload neighbours so swiping feels instant.
  useEffect(() => {
    for (const d of [1, -1]) {
      const it = items[(index + d + n) % n];
      if (it?.full) {
        const img = new window.Image();
        img.src = it.full;
      }
    }
  }, [index, items, n]);

  if (!item) return null;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-label={`Photo ${index + 1} of ${n}`}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-[#0d0f12] p-0 text-white backdrop:bg-black/80"
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "TEXTAREA" || tag === "INPUT") return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        }
      }}
    >
      <div
        className="relative flex h-full w-full flex-col"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const s = touch.current;
          touch.current = null;
          if (!s || n < 2) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx < 0 ? 1 : -1);
          else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose();
        }}
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2 safe-top sm:px-5">
          <span className="text-sm tabular-nums text-white/80" aria-live="polite">
            {index + 1} / {n}
          </span>
          <div className="flex items-center gap-1">
          {!item.pending ? (
            <button
              type="button"
              onClick={() => setReporting(reporting === item.id ? null : item.id)}
              aria-expanded={reporting === item.id}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm text-white/80 hover:bg-white/10"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 22V4m0 0h12l-2 4 2 4H4" />
              </svg>
              Report photo
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
            aria-label="Close photo viewer"
            autoFocus
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          </div>
        </div>

        <figure className="relative min-h-0 flex-1 px-2 sm:px-16">
          {item.pending ? <PendingBadge /> : null}
          <div className="relative h-full w-full" style={{ backgroundColor: "transparent" }}>
            <Image
              key={item.id}
              src={item.full ?? item.card ?? ""}
              alt={item.alt || `${vendorName} photo ${index + 1}`}
              fill
              unoptimized
              sizes="100vw"
              className="select-none object-contain"
              draggable={false}
            />
          </div>
        </figure>

        <div className="safe-bottom px-4 pt-3 text-center sm:px-6">
          {reporting === item.id ? (
            <ReportPhoto key={item.id} mediaId={item.id} onDone={() => setReporting(null)} />
          ) : (
            <p className="mx-auto min-h-5 max-w-[60ch] text-sm text-white/85">{item.caption}</p>
          )}
        </div>

        {n > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className="absolute left-1 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-4 sm:flex"
              aria-label="Previous photo"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="absolute right-1 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-4 sm:flex"
              aria-label="Next photo"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            {/* Phone: prev/next as a bottom pair, thumbs reach them easily. */}
            <div className="flex justify-center gap-3 pb-3 sm:hidden">
              <button type="button" onClick={() => go(-1)} className="btn btn-sm border-white/20 bg-white/10 text-white" aria-label="Previous photo">
                Prev
              </button>
              <button type="button" onClick={() => go(1)} className="btn btn-sm border-white/20 bg-white/10 text-white" aria-label="Next photo">
                Next
              </button>
            </div>
          </>
        ) : null}
      </div>
    </dialog>
  );
}

export default function Gallery({
  photos,
  videos,
  albums,
  vendorName,
}: {
  photos: GalleryItem[];
  videos: GalleryItem[];
  albums: GalleryAlbum[];
  vendorName: string;
}) {
  const [tab, setTab] = useState<Tab>({ kind: "all" });
  const [open, setOpen] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const shown =
    tab.kind === "album" ? photos.filter((p) => p.albumId === tab.id) : tab.kind === "all" ? photos : [];
  const shownVideos = tab.kind === "videos" ? videos : tab.kind === "album" ? videos.filter((v) => v.albumId === tab.id) : [];
  const album = tab.kind === "album" ? albums.find((a) => a.id === tab.id) : undefined;
  const LIMIT = 9;
  const visible = showAll ? shown : shown.slice(0, LIMIT);

  const chips: { key: string; label: string; active: boolean; onClick: () => void }[] = [
    { key: "all", label: `All photos (${photos.length})`, active: tab.kind === "all", onClick: () => setTab({ kind: "all" }) },
    ...albums.map((a) => ({
      key: `a${a.id}`,
      label: `${a.title} (${a.count})`,
      active: tab.kind === "album" && tab.id === a.id,
      onClick: () => setTab({ kind: "album", id: a.id }),
    })),
    ...(videos.length
      ? [{ key: "v", label: `Videos (${videos.length})`, active: tab.kind === "videos", onClick: () => setTab({ kind: "videos" }) }]
      : []),
  ];

  return (
    <div>
      {chips.length > 1 ? (
        <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Gallery filter">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={c.active}
              onClick={() => {
                c.onClick();
                setShowAll(false);
              }}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors sm:min-h-9 ${
                c.active
                  ? "border-accent bg-accent-tint text-accent-hover"
                  : "border-line-strong bg-surface text-foreground hover:bg-surface-muted"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      {album?.description ? <p className="mb-3 text-sm text-ink-soft">{album.description}</p> : null}

      {visible.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visible.map((p, i) => (
            <li key={p.id} className="relative aspect-[4/3] overflow-hidden rounded-control" style={{ backgroundColor: p.placeholderColor ?? "var(--color-surface-muted)" }}>
              {p.pending ? <PendingBadge /> : null}
              <button
                type="button"
                onClick={() => setOpen(i)}
                className="group absolute inset-0 h-full w-full"
                aria-label={`Open photo ${i + 1}${p.caption ? `: ${p.caption}` : ""}`}
              >
                <Image
                  src={p.card ?? p.full ?? ""}
                  alt={p.alt || `${vendorName} portfolio photo`}
                  fill
                  unoptimized
                  loading={i < 3 ? "eager" : "lazy"}
                  sizes="(min-width: 640px) 33vw, 50vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {shown.length > LIMIT && !showAll ? (
        <button type="button" onClick={() => setShowAll(true)} className="btn btn-secondary btn-sm mt-3">
          Show all {shown.length} photos
        </button>
      ) : null}

      {shownVideos.length > 0 ? (
        <ul className={`grid gap-4 sm:grid-cols-2 ${visible.length ? "mt-5" : ""}`} aria-label="Videos">
          {shownVideos.map((v) => (
            <li key={v.id}>
              <VideoCard item={v} vendorName={vendorName} />
            </li>
          ))}
        </ul>
      ) : null}

      {open !== null && shown[open] ? (
        <Lightbox items={shown} index={open} onIndex={setOpen} onClose={() => setOpen(null)} vendorName={vendorName} />
      ) : null}
    </div>
  );
}
