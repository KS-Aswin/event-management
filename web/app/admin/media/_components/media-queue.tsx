"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MediaAction, MediaQueueItem, MediaTab } from "@/lib/admin/moderation";
import { AdminEmptyState } from "@/app/admin/_components/admin-page";
import { postAdmin, ReasonDialog, type ReasonRequest } from "./reason-dialog";

const EMPTY: Record<MediaTab, { title: string; body: string }> = {
  pre: { title: "Nothing waiting", body: "No photos or videos from new listings need a check right now." },
  recent: { title: "All caught up", body: "Every upload from live vendors in the last 14 days has been checked." },
  reported: { title: "No reported media", body: "When visitors report a photo, it shows up here." },
};

const REJECT_PRESETS = [
  "Low quality or blurry",
  "Not your own work",
  "Contact details or watermark in the image",
  "Inappropriate content",
  "Doesn't match your category",
];

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending_review: { text: "Waiting", cls: "bg-[#fdf3d6] text-gold-ink" },
  approved: { text: "Public", cls: "bg-accent-tint text-accent-hover" },
  rejected: { text: "Rejected", cls: "bg-danger-tint text-danger" },
  hidden: { text: "Hidden", cls: "bg-surface-muted text-ink-soft" },
};

const DONE_TEXT: Record<MediaAction, string> = {
  approve: "Approved.",
  reject: "Rejected. The vendor can see your reason.",
  hide: "Hidden from the profile. The vendor was told why.",
  remove: "Removed and the files deleted. The vendor was told why.",
};

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function MediaQueueGrid({ tab, items: initial }: { tab: MediaTab; items: MediaQueueItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [dialog, setDialog] = useState<ReasonRequest | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function run(item: MediaQueueItem, action: MediaAction, reason: string): Promise<string | null> {
    setBusyId(item.id);
    const r = await postAdmin(`/api/admin/media/${item.id}/decision`, { action, reason: reason || undefined });
    setBusyId(null);
    if (!r.ok && r.status !== 409 && r.status !== 404) return r.error;
    setItems((list) => list.filter((x) => x.id !== item.id));
    setMessage(
      r.ok
        ? { kind: "ok", text: `${item.vendor.name}: ${DONE_TEXT[action]}` }
        : { kind: "error", text: `${r.error} The list has been refreshed.` }
    );
    router.refresh();
    return null;
  }

  function ask(item: MediaQueueItem, action: MediaAction) {
    const what = item.kind === "image" ? "photo" : "video";
    if (action === "reject") {
      setDialog({
        title: `Reject this ${what}?`,
        description: `${item.vendor.name} sees the reason in their media manager and can upload a better one.`,
        confirmLabel: "Reject",
        danger: true,
        presets: REJECT_PRESETS,
        label: "Reason for the vendor",
        onConfirm: (reason) => run(item, "reject", reason),
      });
    } else if (action === "hide") {
      setDialog({
        title: `Hide this ${what}?`,
        description: "It leaves the public profile but stays in the vendor's account. Only an admin can show it again.",
        confirmLabel: "Hide",
        danger: true,
        presets: REJECT_PRESETS,
        label: "Reason for the vendor",
        onConfirm: (reason) => run(item, "hide", reason),
      });
    } else if (action === "remove") {
      setDialog({
        title: `Remove this ${what} for good?`,
        description: "The files are deleted and this can't be undone. Use it for clearly illegal or abusive content.",
        confirmLabel: "Remove permanently",
        danger: true,
        presets: ["Abusive or illegal content", "Copyright complaint", "Private photo shared without consent"],
        label: "Reason for the vendor",
        onConfirm: (reason) => run(item, "remove", reason),
      });
    }
  }

  const approveLabel = tab === "recent" ? "Looks fine" : tab === "reported" ? "Keep" : "Approve";

  return (
    <>
      <div aria-live="polite" className="min-h-0">
        {message ? (
          <div className={`${message.kind === "ok" ? "alert-success" : "alert-error"} mb-4 flex items-start justify-between gap-3`}>
            <span>{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="shrink-0 font-medium underline underline-offset-2">
              Dismiss
            </button>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <AdminEmptyState title={EMPTY[tab].title} body={EMPTY[tab].body} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" data-testid="media-queue">
          {items.map((item) => {
            const st = STATUS_LABEL[item.status];
            const busy = busyId === item.id;
            const what = item.kind === "image" ? "photo" : "video";
            const alt = item.altText || item.caption || `${item.vendor.name} ${what}`;
            return (
              <li key={item.id} className="card flex min-w-0 flex-col p-0 overflow-hidden" data-media-id={item.id}>
                <a
                  href={item.full ?? item.externalUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative block aspect-[4/3] bg-surface-muted"
                  style={{ backgroundColor: item.placeholderColor ?? undefined }}
                  aria-label={`Open full size ${what} from ${item.vendor.name} in a new tab`}
                >
                  {item.thumb ? (
                    <Image src={item.thumb} alt={alt} fill unoptimized sizes="(min-width:1024px) 33vw, 100vw" className="object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-caption text-ink-soft">No preview</span>
                  )}
                  {item.kind !== "image" ? (
                    <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-xs text-white">Video</span>
                  ) : null}
                  {item.purpose !== "gallery" ? (
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs capitalize text-white">
                      {item.purpose}
                    </span>
                  ) : null}
                </a>

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/admin/vendors/${item.vendor.id}`} className="min-w-0 truncate font-medium hover:underline">
                      {item.vendor.name}
                    </Link>
                    {st ? <span className={`shrink-0 rounded-full px-2 text-xs leading-5 ${st.cls}`}>{st.text}</span> : null}
                  </div>
                  <p className="mt-0.5 text-caption text-ink-soft">
                    {[item.vendor.district, `listing ${item.vendor.status.replace("_", " ")}`, `uploaded ${when(item.createdAt)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {item.caption ? <p className="mt-2 line-clamp-2 text-body">{item.caption}</p> : null}

                  {item.reports.length ? (
                    <div className="mt-3 rounded-control bg-danger-tint/60 p-3">
                      <p className="text-caption font-semibold text-danger">
                        {item.reports.length} open report{item.reports.length === 1 ? "" : "s"}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {item.reports.slice(0, 3).map((r) => (
                          <li key={r.id} className="text-caption text-foreground">
                            “{r.reason}” <span className="text-ink-soft">· {when(r.createdAt)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => void run(item, "approve", "")}
                      aria-label={`${approveLabel}: ${what} from ${item.vendor.name}`}
                    >
                      {busy ? "Saving..." : approveLabel}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => ask(item, "reject")}>
                      Reject
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => ask(item, "hide")}>
                      Hide
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm text-danger hover:bg-danger-tint"
                      disabled={busy}
                      onClick={() => ask(item, "remove")}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ReasonDialog request={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
