"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ReasonDialog, type ReasonRequest } from "@/app/admin/media/_components/reason-dialog";
import type { AdminVendorDetail } from "@/lib/admin/vendors";
import { adminFetch } from "./api";

// Media strip on the vendor detail page: every photo and video with its
// status; waiting items get Approve / Reject (reject needs a reason the
// vendor sees). Approving the listing approves whatever is still waiting.

type Media = AdminVendorDetail["media"][number];

const STATUS: Record<string, { text: string; cls: string }> = {
  pending_review: { text: "Waiting", cls: "bg-[#fdf3d6] text-gold-ink" },
  approved: { text: "Public", cls: "bg-accent-tint text-accent-hover" },
  rejected: { text: "Rejected", cls: "bg-danger-tint text-danger" },
  hidden: { text: "Hidden", cls: "bg-surface-muted text-ink-soft" },
};

const PRESETS = [
  "Low quality or blurry",
  "Not your own work",
  "Contact details or watermark in the image",
  "Inappropriate content",
  "Doesn't match your category",
];

export default function MediaReview({ vendorId, vendorName, media }: { vendorId: number; vendorName: string; media: Media[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<ReasonRequest | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function decide(m: Media, action: "approve" | "reject", reason: string): Promise<string | null> {
    setBusyId(m.id);
    const r = await adminFetch(`/api/admin/vendors/${vendorId}/media/${m.id}`, "POST", { action, reason: reason || undefined });
    setBusyId(null);
    if (!r.ok && r.status !== 409) return r.error;
    setMessage(
      r.ok
        ? { kind: "ok", text: action === "approve" ? "Approved." : "Rejected. The vendor can see your reason." }
        : { kind: "error", text: "Someone already handled that item. The page has been refreshed." }
    );
    router.refresh();
    return null;
  }

  function reject(m: Media) {
    const what = m.kind === "image" ? "photo" : "video";
    setDialog({
      title: `Reject this ${what}?`,
      description: `${vendorName} sees the reason in their media manager and can upload a better one.`,
      confirmLabel: "Reject",
      danger: true,
      presets: PRESETS,
      label: "Reason for the vendor",
      onConfirm: (reason) => decide(m, "reject", reason),
    });
  }

  if (media.length === 0) {
    return <p className="text-body text-ink-soft">No photos or videos yet.</p>;
  }

  return (
    <>
      <div aria-live="polite">
        {message ? (
          <div className={`${message.kind === "ok" ? "alert-success" : "alert-error"} mb-3 flex items-start justify-between gap-3`}>
            <span>{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="shrink-0 font-medium underline underline-offset-2">
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" data-testid="vendor-media">
        {media.map((m) => {
          const st = STATUS[m.status] ?? { text: m.status.replace(/_/g, " "), cls: "bg-surface-muted text-ink-soft" };
          const what = m.kind === "image" ? "photo" : "video";
          const busy = busyId === m.id;
          return (
            <li key={m.id} className="min-w-0 rounded-card border border-line overflow-hidden bg-white flex flex-col" data-media-id={m.id}>
              <a
                href={m.full ?? m.external_url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="relative block aspect-[4/3] bg-surface-muted"
                aria-label={`Open full size ${what} in a new tab`}
              >
                {m.thumb ? (
                  <Image src={m.thumb} alt={m.alt_text || m.caption || `${vendorName} ${what}`} fill unoptimized sizes="(min-width:1280px) 20vw, 50vw" className="object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-caption text-ink-soft">No preview</span>
                )}
                <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.text}</span>
                {m.purpose !== "gallery" && (
                  <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs text-white capitalize">{m.purpose}</span>
                )}
              </a>
              <div className="p-2.5 flex-1 flex flex-col gap-2">
                {m.caption && <p className="text-caption line-clamp-2 break-words">{m.caption}</p>}
                {m.status_reason && <p className="text-caption text-danger break-words">“{m.status_reason}”</p>}
                {m.report_count > 0 && <p className="text-caption text-ink-soft">{m.report_count} report{m.report_count === 1 ? "" : "s"}</p>}
                {m.status === "pending_review" && (
                  <div className="mt-auto grid grid-cols-2 gap-1.5">
                    <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={busy} onClick={() => decide(m, "approve", "")}>
                      {busy ? "…" : "Approve"}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm min-h-11 text-danger" disabled={busy} onClick={() => reject(m)}>
                      Reject
                    </button>
                  </div>
                )}
                {m.status === "approved" && (
                  <button type="button" className="mt-auto btn btn-secondary btn-sm min-h-11 text-danger" disabled={busy} onClick={() => reject(m)}>
                    Take down
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <ReasonDialog request={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
