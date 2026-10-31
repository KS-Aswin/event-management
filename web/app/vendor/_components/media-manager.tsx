"use client";

// Vendor media manager (P0-7, /vendor/media). Grid with status pills,
// albums (create / rename / delete), captions and alt text, featured, logo
// and cover, reorder (drag on desktop + Move earlier/later buttons), delete
// with an in-page confirm, consent, usage meter, per-file progress + Retry,
// video links, MP4 uploads when enabled. Everything goes through the
// owner-scoped /api/vendor/media* routes.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import MediaUploader, { type ClientAsset } from "./media-uploader";

interface Album {
  id: number;
  title: string;
  description: string;
  consentConfirmedAt: string | null;
  published: boolean;
}

interface Library {
  assets: ClientAsset[];
  albums: Album[];
  logoMediaId: number | null;
  coverMediaId: number | null;
  usage: { images: number; videoLinks: number; videoFiles: number; albums: number };
  limits: { plan: string; images: number | null; albums: number | null; videoLinks: number | null; videoFiles: number | null };
  videoUploadsEnabled: boolean;
}

type Filter = "all" | "none" | number;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string };
    throw new Error(b.error || `Request failed (${res.status}).`);
  }
  return body as T;
}

const STATUS_PILL: Record<string, { label: string; cls: string } | undefined> = {
  pending_review: { label: "Under review", cls: "bg-gold-ink text-white" },
  rejected: { label: "Rejected", cls: "bg-danger text-white" },
  hidden: { label: "Hidden", cls: "bg-[#3c4043] text-white" },
  processing: { label: "Processing", cls: "bg-[#3c4043] text-white" },
};

function statusText(a: ClientAsset): string | null {
  if (a.status === "hidden") {
    if (a.statusReason?.startsWith("admin:")) return `Hidden by Vela: ${a.statusReason.slice(6).trim()}`;
    return a.statusReason === "plan_limit" ? "Hidden: over plan limit" : "Hidden from your profile";
  }
  if (a.status === "rejected") return `Rejected${a.statusReason ? `: ${a.statusReason}` : ""}`;
  if (a.status === "pending_review") return "Under review: customers see it once approved";
  return null;
}

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const near = max !== null && used >= max;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span className="text-ink-soft">{label}</span>
        <span className={`tabular-nums font-medium ${near ? "text-danger" : "text-foreground"}`}>
          {used}
          {max !== null ? ` of ${max}` : ""}
        </span>
      </div>
      {max !== null ? (
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={used}
        >
          <div className={`h-full rounded-full ${near ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function Thumb({ a, posters, className = "" }: { a: ClientAsset; posters: Map<number, ClientAsset>; className?: string }) {
  const poster = a.posterMediaId ? posters.get(a.posterMediaId) : undefined;
  const src =
    a.kind === "image"
      ? a.urls.thumb ?? a.urls.card ?? a.urls.full
      : a.kind === "video_link"
        ? a.thumbnailUrl
        : poster?.urls.thumb ?? poster?.urls.card ?? poster?.urls.full;
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ backgroundColor: a.placeholderColor ?? (a.kind === "image" ? "var(--color-surface-muted)" : "#1f2328") }}>
      {src ? (
        <Image src={src} alt={a.altText || a.caption || ""} fill unoptimized sizes="(min-width: 1024px) 220px, (min-width: 640px) 30vw, 50vw" className="object-cover" draggable={false} />
      ) : null}
      {a.kind !== "image" ? (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 pl-0.5 text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
            </svg>
          </span>
        </span>
      ) : null}
    </div>
  );
}

function ConfirmBar({
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div role="alertdialog" aria-label={message} className="rounded-control border border-danger/30 bg-danger-tint p-3">
      <p className="text-sm text-danger">{message}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button ref={ref} type="button" className="btn btn-sm bg-danger text-white hover:opacity-90" disabled={busy} onClick={onConfirm}>
          {busy ? "Deleting…" : confirmLabel}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EditSheet({
  asset,
  albums,
  isCover,
  isLogo,
  posters,
  onClose,
  onSaved,
  onDeleted,
  onSetRole,
}: {
  asset: ClientAsset;
  albums: Album[];
  isCover: boolean;
  isLogo: boolean;
  posters: Map<number, ClientAsset>;
  onClose: () => void;
  onSaved: (a: ClientAsset) => void;
  onDeleted: (id: number) => void;
  onSetRole: (which: "logo" | "cover", id: number | null) => Promise<void>;
}) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [caption, setCaption] = useState(asset.caption ?? "");
  const [alt, setAlt] = useState(asset.altText ?? "");
  const [albumId, setAlbumId] = useState<string>(asset.albumId ? String(asset.albumId) : "");
  const [featured, setFeatured] = useState(asset.isFeatured);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isImage = asset.kind === "image";
  const usable = isImage && asset.status !== "rejected";

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ asset: ClientAsset }>(`/api/vendor/media/${asset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ caption, altText: alt, albumId: albumId ? Number(albumId) : null, isFeatured: featured }),
      });
      onSaved(r.asset);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await api(`/api/vendor/media/${asset.id}`, { method: "DELETE" });
      onDeleted(asset.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  async function role(which: "logo" | "cover", on: boolean) {
    setError(null);
    try {
      await onSetRole(which, on ? asset.id : null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const kindLabel = isImage ? "photo" : "video";
  const note = statusText(asset);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${uid}-t`}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-card bg-surface p-0 shadow-pop backdrop:bg-black/45 sm:m-auto sm:max-w-[560px] sm:rounded-card"
    >
      <form onSubmit={save} className="p-4 sm:p-6 safe-bottom">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={`${uid}-t`} className="font-display text-title font-semibold">
            Edit {kindLabel}
          </h2>
          <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-muted" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <Thumb a={asset} posters={posters} className="aspect-video w-full rounded-control" />
        {note ? <p className={`mt-2 text-caption ${asset.status === "rejected" ? "text-danger" : "text-ink-soft"}`}>{note}</p> : null}
        {asset.kind === "video_link" && asset.externalUrl ? (
          <p className="mt-2 truncate text-caption">
            <a href={asset.externalUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              {asset.externalUrl}
            </a>
          </p>
        ) : null}

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor={`${uid}-cap`} className="label">
              Caption
            </label>
            <textarea id={`${uid}-cap`} className="field" style={{ minHeight: 72 }} maxLength={300} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Anu & Rahul · St. Mary's, Kottayam" />
          </div>
          {isImage ? (
            <div>
              <label htmlFor={`${uid}-alt`} className="label">
                Description for screen readers <span className="font-normal text-ink-soft">(optional)</span>
              </label>
              <input id={`${uid}-alt`} className="field" maxLength={200} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="What is in the photo" />
            </div>
          ) : null}
          <div>
            <label htmlFor={`${uid}-album`} className="label">
              Album
            </label>
            <select id={`${uid}-album`} className="field" value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
              <option value="">Not in an album</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[var(--color-accent)]" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
            <span>
              <span className="font-medium">Featured</span>
              <span className="block text-caption text-ink-soft">Shown first on your profile and used for your search card when there is no cover.</span>
            </span>
          </label>
          {usable ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => role("cover", !isCover)}>
                {isCover ? "Remove as cover" : "Use as cover photo"}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => role("logo", !isLogo)}>
                {isLogo ? "Remove as logo" : "Use as logo"}
              </button>
            </div>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="alert-error mt-4">
            {error}
          </p>
        ) : null}

        <div className="mt-5">
          {confirming ? (
            <ConfirmBar
              message={`Delete this ${kindLabel}? It is removed from your profile and can't be restored.`}
              confirmLabel={`Delete ${kindLabel}`}
              busy={deleting}
              onConfirm={remove}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="btn btn-ghost btn-sm text-danger hover:bg-danger-tint" onClick={() => setConfirming(true)}>
                Delete
              </button>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </form>
    </dialog>
  );
}

function BrandSlot({
  which,
  asset,
  onUploaded,
  onRemove,
}: {
  which: "logo" | "cover";
  asset: ClientAsset | undefined;
  onUploaded: () => void;
  onRemove: () => void;
}) {
  const src = asset ? (which === "logo" ? asset.urls.card ?? asset.urls.full : asset.urls.card ?? asset.urls.full) : null;
  const pill = asset ? STATUS_PILL[asset.status] : undefined;
  return (
    <div className="card p-4">
      <div className="flex items-start gap-4">
        <div
          className={`relative shrink-0 overflow-hidden border border-line bg-surface-muted ${
            which === "logo" ? "h-20 w-20 rounded-card" : "aspect-video w-36 rounded-control sm:w-44"
          }`}
        >
          {src ? (
            <Image src={src} alt={which === "logo" ? "Your logo" : "Your cover photo"} fill unoptimized sizes="176px" className="object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-caption text-ink-soft">None yet</span>
          )}
          {pill ? <span className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${pill.cls}`}>{pill.label}</span> : null}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{which === "logo" ? "Logo" : "Cover photo"}</h3>
          <p className="mt-0.5 text-caption text-ink-soft">
            {which === "logo"
              ? "Square, at least 200 × 200 px. Shown beside your name."
              : "Wide 16:9, at least 1200 × 675 px. Top of your profile and on search cards."}
          </p>
          <div className="mt-2.5 flex flex-wrap items-start gap-2">
            <MediaUploader
              purpose={which}
              compact
              single
              consent={false}
              label={asset ? "Replace" : which === "logo" ? "Upload logo" : "Upload cover"}
              onUploaded={onUploaded}
            />
            {asset ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MediaManager({ vendorId, vendorStatus }: { vendorId: number; vendorStatus: string }) {
  const uid = useId();
  const [lib, setLib] = useState<Library | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [newAlbum, setNewAlbum] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmAlbum, setConfirmAlbum] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<Library>("/api/vendor/media");
      setLib(data);
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  const say = (text: string, tone: "ok" | "error" = "ok") => setNotice({ text, tone });

  const all = useMemo(() => lib?.assets ?? [], [lib]);
  const posters = useMemo(() => new Map(all.map((a) => [a.id, a])), [all]);
  const gallery = useMemo(
    () => all.filter((a) => a.purpose === "gallery").sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [all]
  );
  const visible = useMemo(
    () => gallery.filter((a) => (filter === "all" ? true : filter === "none" ? a.albumId == null : a.albumId === filter)),
    [gallery, filter]
  );
  const currentAlbum = typeof filter === "number" ? lib?.albums.find((a) => a.id === filter) : undefined;
  const uploadAlbumId = typeof filter === "number" ? filter : null;

  if (loadError && !lib) {
    return (
      <div className="card text-center">
        <p className="font-semibold">Couldn&apos;t load your media</p>
        <p className="mt-1 text-sm text-ink-soft">{loadError}</p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!lib) {
    return (
      <div aria-busy="true" aria-label="Loading media" className="space-y-4">
        <div className="h-24 animate-pulse rounded-card bg-surface-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="aspect-[4/3] animate-pulse rounded-card bg-surface-muted" />
          ))}
        </div>
      </div>
    );
  }

  const L = lib;
  const atImageLimit = L.limits.images !== null && L.usage.images >= L.limits.images;
  const atAlbumLimit = L.limits.albums !== null && L.usage.albums >= L.limits.albums;
  const atLinkLimit = L.limits.videoLinks !== null && L.usage.videoLinks >= L.limits.videoLinks;
  const cover = L.coverMediaId ? all.find((a) => a.id === L.coverMediaId) : undefined;
  const logo = L.logoMediaId ? all.find((a) => a.id === L.logoMediaId) : undefined;
  const editAsset = editing !== null ? all.find((a) => a.id === editing) : undefined;

  function replaceAsset(a: ClientAsset) {
    setLib((cur) => (cur ? { ...cur, assets: cur.assets.map((x) => (x.id === a.id ? a : x)) } : cur));
  }

  async function setRole(which: "logo" | "cover", id: number | null) {
    await api(`/api/vendor/media/${which}`, { method: "PUT", body: JSON.stringify({ mediaId: id }) });
    setLib((cur) => (cur ? { ...cur, [which === "logo" ? "logoMediaId" : "coverMediaId"]: id } : cur));
    say(id ? `${which === "logo" ? "Logo" : "Cover photo"} updated.` : `${which === "logo" ? "Logo" : "Cover photo"} removed.`);
  }

  async function saveOrder(next: ClientAsset[]) {
    // `next` is the new order of the visible items; slot them back into the
    // full gallery order at the positions the visible items held.
    const ids = new Set(next.map((a) => a.id));
    const slots = gallery.map((a, i) => (ids.has(a.id) ? i : -1)).filter((i) => i >= 0);
    const full = [...gallery];
    slots.forEach((slot, n) => (full[slot] = next[n]));
    const order = full.map((a, i) => ({ ...a, sortOrder: i + 1 }));
    setLib((cur) =>
      cur ? { ...cur, assets: cur.assets.map((a) => order.find((o) => o.id === a.id) ?? a) } : cur
    );
    try {
      await api("/api/vendor/media/reorder", { method: "POST", body: JSON.stringify({ ids: full.map((a) => a.id) }) });
      say("Order saved.");
    } catch (err) {
      say((err as Error).message, "error");
      void load();
    }
  }

  function move(id: number, delta: number) {
    const i = visible.findIndex((a) => a.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= visible.length) return;
    const next = [...visible];
    [next[i], next[j]] = [next[j], next[i]];
    void saveOrder(next);
    // Keep keyboard focus on the moved item's button.
    requestAnimationFrame(() => document.getElementById(`${uid}-mv-${id}-${delta < 0 ? "up" : "down"}`)?.focus());
  }

  function dropOn(targetId: number) {
    if (dragId === null || dragId === targetId) return;
    const next = visible.filter((a) => a.id !== dragId);
    const dragged = visible.find((a) => a.id === dragId);
    const at = next.findIndex((a) => a.id === targetId);
    if (!dragged || at < 0) return;
    const from = visible.findIndex((a) => a.id === dragId);
    const to = visible.findIndex((a) => a.id === targetId);
    next.splice(from < to ? at + 1 : at, 0, dragged);
    void saveOrder(next);
  }

  async function toggleFeatured(a: ClientAsset) {
    try {
      const r = await api<{ asset: ClientAsset }>(`/api/vendor/media/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isFeatured: !a.isFeatured }),
      });
      replaceAsset(r.asset);
    } catch (err) {
      say((err as Error).message, "error");
    }
  }

  async function createAlbum(e: React.FormEvent) {
    e.preventDefault();
    if (!newAlbum?.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ album: Album }>("/api/vendor/albums", {
        method: "POST",
        body: JSON.stringify({ title: newAlbum.trim() }),
      });
      setNewAlbum(null);
      await load();
      setFilter(r.album.id);
      say(`Album “${r.album.title}” created. Photos you add now go into it.`);
    } catch (err) {
      say((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function renameAlbum(e: React.FormEvent) {
    e.preventDefault();
    if (!currentAlbum || !renaming?.trim()) return;
    setBusy(true);
    try {
      await api(`/api/vendor/albums/${currentAlbum.id}`, { method: "PATCH", body: JSON.stringify({ title: renaming.trim() }) });
      setRenaming(null);
      await load();
      say("Album renamed.");
    } catch (err) {
      say((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAlbum() {
    if (!currentAlbum) return;
    setBusy(true);
    try {
      await api(`/api/vendor/albums/${currentAlbum.id}`, { method: "DELETE" });
      setConfirmAlbum(false);
      setFilter("all");
      await load();
      say("Album deleted. Its photos are still in your gallery.");
    } catch (err) {
      say((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    setLinkError(null);
    if (!link.trim()) {
      setLinkError("Paste a YouTube, Instagram or Vimeo link.");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ asset: ClientAsset; duplicate: boolean }>("/api/vendor/media/links", {
        method: "POST",
        body: JSON.stringify({ url: link.trim(), albumId: uploadAlbumId ?? undefined }),
      });
      setLink("");
      await load();
      say(r.duplicate ? "That video is already in your gallery." : "Video added.");
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function confirmConsent() {
    if (currentAlbum && !currentAlbum.consentConfirmedAt) {
      void api(`/api/vendor/albums/${currentAlbum.id}`, { method: "PATCH", body: JSON.stringify({ consentConfirmed: true }) }).catch(() => {});
    }
  }

  const albumCount = (id: number) => gallery.filter((a) => a.albumId === id).length;
  const chip = (active: boolean) =>
    `inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors sm:min-h-9 ${
      active ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong bg-surface text-foreground hover:bg-surface-muted"
    }`;

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="sr-only">
        {notice?.tone === "ok" ? notice.text : ""}
      </div>
      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : undefined}
          className={`flex items-start justify-between gap-3 ${notice.tone === "error" ? "alert-error" : "alert-success"}`}
        >
          <span>{notice.text}</span>
          <button type="button" className="-my-2.5 inline-flex min-h-11 shrink-0 items-center px-2 text-caption font-medium underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {vendorStatus !== "approved" ? (
        <p className="rounded-control bg-surface-muted px-3.5 py-2.5 text-sm text-ink-soft">
          Your listing isn&apos;t live yet, so new photos and videos are reviewed together with it. You can{" "}
          <Link href={`/vendors/${vendorId}`} className="font-medium text-accent hover:underline">
            preview your profile
          </Link>{" "}
          any time.
        </p>
      ) : null}

      <section aria-labelledby={`${uid}-usage`} className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${uid}-usage`} className="text-sm font-semibold">
            Usage
          </h2>
          <span className="chip capitalize">{L.limits.plan} plan</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 lg:grid-cols-4">
          <Meter label="Photos" used={L.usage.images} max={L.limits.images} />
          <Meter label="Video links" used={L.usage.videoLinks} max={L.limits.videoLinks} />
          {L.videoUploadsEnabled ? <Meter label="MP4 videos" used={L.usage.videoFiles} max={L.limits.videoFiles} /> : null}
          <Meter label="Albums" used={L.usage.albums} max={L.limits.albums} />
        </div>
        <p className="mt-3 text-caption text-ink-soft">Logo, cover and video posters don&apos;t count toward your limits.</p>
      </section>

      <section aria-labelledby={`${uid}-brand`}>
        <h2 id={`${uid}-brand`} className="mb-2 text-sm font-semibold">
          Logo &amp; cover
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BrandSlot which="cover" asset={cover} onUploaded={() => void load().then(() => say("Cover photo updated."))} onRemove={() => void setRole("cover", null).catch((e) => say(e.message, "error"))} />
          <BrandSlot which="logo" asset={logo} onUploaded={() => void load().then(() => say("Logo updated."))} onRemove={() => void setRole("logo", null).catch((e) => say(e.message, "error"))} />
        </div>
      </section>

      <section aria-labelledby={`${uid}-add`} className="card p-4 sm:p-5">
        <h2 id={`${uid}-add`} className="text-sm font-semibold">
          Add to your gallery{currentAlbum ? <span className="font-normal text-ink-soft"> · into “{currentAlbum.title}”</span> : null}
        </h2>
        <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <MediaUploader
            purpose="gallery"
            albumId={uploadAlbumId}
            videosEnabled={L.videoUploadsEnabled}
            disabled={atImageLimit && !L.videoUploadsEnabled}
            disabledReason={`You've used all ${L.limits.images} photos on your plan. Delete a photo to add another.`}
            onConsent={confirmConsent}
            onUploaded={() => void load()}
          />
          <form onSubmit={addLink} noValidate>
            <label htmlFor={`${uid}-link`} className="label">
              Video link
            </label>
            <div className="flex gap-2">
              <input
                id={`${uid}-link`}
                type="url"
                inputMode="url"
                className="field"
                placeholder="YouTube, Instagram or Vimeo link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                aria-invalid={linkError ? true : undefined}
                aria-describedby={`${uid}-link-hint`}
                disabled={atLinkLimit}
              />
              <button type="submit" className="btn btn-secondary shrink-0" disabled={busy || atLinkLimit}>
                Add
              </button>
            </div>
            <p id={`${uid}-link-hint`} className={linkError ? "hint text-danger" : "hint"} role={linkError ? "alert" : undefined}>
              {linkError ?? (atLinkLimit ? "You've reached your plan's video link limit." : "Showreels and reels play on your profile when tapped.")}
            </p>
          </form>
        </div>
      </section>

      <section aria-labelledby={`${uid}-gallery`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id={`${uid}-gallery`} className="text-sm font-semibold">
            Gallery <span className="font-normal text-ink-soft">({gallery.length})</span>
          </h2>
          {gallery.length > 1 ? <p className="hidden text-caption text-ink-soft sm:block">Drag to reorder, or use the arrows.</p> : null}
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none]" role="group" aria-label="Albums">
          <button type="button" className={chip(filter === "all")} aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setRenaming(null); setConfirmAlbum(false); }}>
            All ({gallery.length})
          </button>
          {L.albums.length ? (
            <button type="button" className={chip(filter === "none")} aria-pressed={filter === "none"} onClick={() => { setFilter("none"); setRenaming(null); setConfirmAlbum(false); }}>
              Not in an album
            </button>
          ) : null}
          {L.albums.map((a) => (
            <button key={a.id} type="button" className={chip(filter === a.id)} aria-pressed={filter === a.id} onClick={() => { setFilter(a.id); setRenaming(null); setConfirmAlbum(false); }}>
              {a.title} ({albumCount(a.id)})
            </button>
          ))}
          {newAlbum === null ? (
            <button
              type="button"
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-dashed border-line-strong px-3.5 text-[13px] font-medium text-accent hover:bg-accent-tint disabled:opacity-50 sm:min-h-9"
              onClick={() => setNewAlbum("")}
              disabled={atAlbumLimit}
              title={atAlbumLimit ? "Album limit reached for your plan" : undefined}
            >
              + New album
            </button>
          ) : null}
        </div>

        {newAlbum !== null ? (
          <form onSubmit={createAlbum} className="mb-3 flex flex-wrap items-end gap-2 rounded-control bg-surface-muted p-3">
            <div className="min-w-[200px] flex-1">
              <label htmlFor={`${uid}-na`} className="label">
                Album name
              </label>
              <input id={`${uid}-na`} className="field" autoFocus maxLength={120} value={newAlbum} onChange={(e) => setNewAlbum(e.target.value)} placeholder="e.g. Anu & Rahul · Kottayam" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || !newAlbum.trim()}>
              Create
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setNewAlbum(null)}>
              Cancel
            </button>
          </form>
        ) : null}

        {currentAlbum ? (
          <div className="mb-3 rounded-control bg-surface-muted p-3">
            {renaming !== null ? (
              <form onSubmit={renameAlbum} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[200px] flex-1">
                  <label htmlFor={`${uid}-rn`} className="label">
                    New name
                  </label>
                  <input id={`${uid}-rn`} className="field" autoFocus maxLength={120} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-primary" disabled={busy || !renaming.trim()}>
                  Save
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : confirmAlbum ? (
              <ConfirmBar
                message={`Delete the album “${currentAlbum.title}”? Its photos stay in your gallery.`}
                confirmLabel="Delete album"
                busy={busy}
                onConfirm={() => void deleteAlbum()}
                onCancel={() => setConfirmAlbum(false)}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <span className="font-medium">{currentAlbum.title}</span>
                  {currentAlbum.consentConfirmedAt ? <span className="text-ink-soft"> · client permission confirmed</span> : null}
                </span>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRenaming(currentAlbum.title)}>
                    Rename
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm text-danger hover:bg-danger-tint" onClick={() => setConfirmAlbum(true)}>
                    Delete album
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {visible.length === 0 ? (
          <div className="rounded-card border border-dashed border-line-strong px-5 py-10 text-center">
            <p className="font-semibold">{gallery.length === 0 ? "No photos yet" : "Nothing in this album yet"}</p>
            <p className="mx-auto mt-1 max-w-[44ch] text-sm text-ink-soft">
              {gallery.length === 0
                ? "Add at least 3 photos of your work (6 or more is best). Your newest wedding, a full setup, your team in action."
                : "Choose this album above, then add photos, or open a photo and pick this album."}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Gallery items">
            {visible.map((a, i) => {
              const pill = STATUS_PILL[a.status];
              const label = a.caption || (a.kind === "image" ? `Photo ${i + 1}` : `Video ${i + 1}`);
              return (
                <li
                  key={a.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(a.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragOver={(e) => {
                    if (dragId === null) return;
                    e.preventDefault();
                    setOverId(a.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(a.id);
                    setDragId(null);
                    setOverId(null);
                  }}
                  className={`group overflow-hidden rounded-card border bg-surface transition-shadow ${
                    overId === a.id && dragId !== a.id ? "border-accent ring-2 ring-accent/40" : "border-line"
                  } ${dragId === a.id ? "opacity-50" : ""}`}
                  data-testid="media-tile"
                  data-media-id={a.id}
                >
                  <div className="relative">
                    <button type="button" className="block w-full cursor-pointer" onClick={() => setEditing(a.id)} aria-label={`Edit ${label}`}>
                      <Thumb a={a} posters={posters} className="aspect-[4/3] w-full" />
                    </button>
                    <div className="pointer-events-none absolute left-1.5 top-1.5 flex flex-wrap gap-1">
                      {pill ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${pill.cls}`}>{pill.label}</span> : null}
                      {a.id === L.coverMediaId ? <span className="rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-medium text-foreground">Cover</span> : null}
                      {a.id === L.logoMediaId ? <span className="rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-medium text-foreground">Logo</span> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleFeatured(a)}
                      aria-pressed={a.isFeatured}
                      aria-label={a.isFeatured ? `Unfeature ${label}` : `Feature ${label}`}
                      className={`absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-full ${a.isFeatured ? "text-gold" : "text-white/90"}`}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/45">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill={a.isFeatured ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                          <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />
                        </svg>
                      </span>
                    </button>
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <p className={`min-w-0 flex-1 truncate text-caption ${a.caption ? "text-foreground" : "text-ink-soft"}`}>
                      {a.caption || (a.status === "rejected" ? statusText(a) : "No caption")}
                    </p>
                    <button
                      id={`${uid}-mv-${a.id}-up`}
                      type="button"
                      className="inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-control text-ink-soft hover:bg-surface-muted disabled:opacity-30 sm:h-9 sm:w-9"
                      onClick={() => move(a.id, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${label} earlier`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    </button>
                    <button
                      id={`${uid}-mv-${a.id}-down`}
                      type="button"
                      className="inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-control text-ink-soft hover:bg-surface-muted disabled:opacity-30 sm:h-9 sm:w-9"
                      onClick={() => move(a.id, 1)}
                      disabled={i === visible.length - 1}
                      aria-label={`Move ${label} later`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editAsset ? (
        <EditSheet
          key={editAsset.id}
          asset={editAsset}
          albums={L.albums}
          isCover={editAsset.id === L.coverMediaId}
          isLogo={editAsset.id === L.logoMediaId}
          posters={posters}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            replaceAsset(a);
            say("Saved.");
          }}
          onDeleted={() => {
            void load();
            say("Deleted.");
          }}
          onSetRole={setRole}
        />
      ) : null}
    </div>
  );
}
