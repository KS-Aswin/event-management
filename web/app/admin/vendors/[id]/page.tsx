import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPage } from "@/app/admin/_components/admin-page";
import { requirePageRole } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { ago, fmtDate, fmtDateTime, StatusChip } from "@/app/admin/users/_components/ui";
import { allowedActions, findFilterOptions, getAdminVendorDetail, type AdminVendorDetail } from "@/lib/admin/vendors";
import DecisionPanel from "../_components/decision-panel";
import MediaReview from "../_components/media-review";
import EditVendorForm, { type EditableVendor } from "../_components/edit-vendor-form";
import AssignOwner from "../_components/assign-owner";

export const metadata: Metadata = { title: "Vendor" };

// P1-3 vendor review page and P1-11 edit / claim: everything an admin needs
// to decide on one listing (profile, offerings, media, documents, status
// history, admin history), the decision buttons, the verified badge, the
// edit-on-behalf form and owner assignment for unclaimed listings.

const inr = new Intl.NumberFormat("en-IN");

function price(o: AdminVendorDetail["offerings"][number]): string {
  if (o.price_mode === "on_request") return "Price on request";
  const from = `₹${inr.format(o.price_from)}`;
  const to = o.price_to ? ` – ₹${inr.format(o.price_to)}` : "";
  const unit = o.price_unit && o.price_unit !== "event" ? ` / ${o.price_unit.replace(/_/g, " ")}` : "";
  return `${o.price_mode === "from" ? "From " : ""}${from}${to}${unit}`;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "empty";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).filter((k) => show(b[k]) !== show(a[k]));
  if (!keys.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-caption">
      {keys.slice(0, 8).map((k) => (
        <li key={k} className="break-words">
          <span className="text-ink-soft">{k.replace(/_/g, " ")}:</span> <del className="text-ink-soft">{show(b[k])}</del>{" "}
          <span aria-hidden="true">→</span> <ins className="no-underline font-medium">{show(a[k])}</ins>
        </li>
      ))}
    </ul>
  );
}

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [, detail, options] = await Promise.all([requirePageRole("admin"), getAdminVendorDetail(id), findFilterOptions()]);
  if (!detail) notFound();
  const { vendor: v, owner } = detail;
  const actions = allowedActions(v.status, !!v.rereview_required);
  const pendingMedia = detail.media.filter((m) => m.status === "pending_review").length;
  const pendingDocs = detail.documents.filter((d) => d.status === "pending").length;
  const hasVerifiedDoc = detail.documents.some((d) => d.valid);

  const editable: EditableVendor = {
    name: v.name,
    vendorType: v.vendor_type,
    primaryCategoryId: v.primary_category_id ?? null,
    districtId: v.district_id,
    location: v.location ?? "",
    about: v.about ?? "",
    phone: v.phone ?? "",
    whatsapp: v.whatsapp ?? "",
    yearsExperience: v.years_experience == null ? "" : String(v.years_experience),
    yearEstablished: v.year_established == null ? "" : String(v.year_established),
    teamSize: v.team_size == null ? "" : String(v.team_size),
    languages: (v.languages ?? []).join(", "),
    tags: (v.tags ?? []).join(", "),
    addressLine: v.address_line ?? "",
    landmark: v.landmark ?? "",
    pincode: v.pincode ?? "",
    legalName: v.legal_name ?? "",
    gstin: v.gstin ?? "",
    fssaiNo: v.fssai_no ?? "",
    instagramUrl: v.instagram_url ?? "",
    youtubeUrl: v.youtube_url ?? "",
    websiteUrl: v.website_url ?? "",
    travelOutsideKerala: !!v.travel_outside_kerala,
    maxEventsPerDay: v.max_events_per_day == null ? "" : String(v.max_events_per_day),
    maxGuests: v.max_guests == null ? "" : String(v.max_guests),
    adminNotes: v.admin_notes ?? "",
  };

  const facts: [string, React.ReactNode][] = [
    ["Category", Array.from(new Set([v.category_name ?? v.category, ...detail.additionalCategories].filter(Boolean))).join(", ") || "–"],
    ["District", Array.from(new Set([v.district_name, v.location].filter(Boolean))).join(" · ") || "–"],
    ["Serves", detail.serviceAreas.length ? detail.serviceAreas.join(", ") : "Home district only"],
    ["Type", <span key="t" className="capitalize">{v.vendor_type}</span>],
    ["Phone", v.phone ?? "Not given"],
    ["WhatsApp", v.whatsapp ?? "Not given"],
    ["Experience", v.years_experience != null ? `${v.years_experience} year${v.years_experience === 1 ? "" : "s"}` : v.experience || "–"],
    ["Languages", v.languages?.length ? v.languages.join(", ") : "–"],
    ["Registered name", v.legal_name ?? "–"],
    ["GSTIN / FSSAI", [v.gstin, v.fssai_no].filter(Boolean).join(" · ") || "–"],
    ["Links", [v.website_url, v.instagram_url, v.youtube_url].filter(Boolean).length ? (
      <span key="l" className="flex flex-col gap-0.5">
        {[v.website_url, v.instagram_url, v.youtube_url].filter(Boolean).map((u) => (
          <a key={u!} href={u!} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 break-all">
            {u}
          </a>
        ))}
      </span>
    ) : "–"],
    ["Created", fmtDate(v.created_at)],
    ["Submitted", v.submitted_at ? `${fmtDateTime(v.submitted_at)} (${ago(v.submitted_at)})` : "Not yet"],
    ["Last review", v.reviewed_at ? `${fmtDateTime(v.reviewed_at)}${v.reviewed_by_name ? ` by ${v.reviewed_by_name}` : ""}` : "Never"],
  ];

  return (
    <AdminPage
      eyebrow="Vendors"
      title={v.name}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusChip status={v.status} />
          {v.verified_at && (
            <span className="chip font-medium bg-accent-tint text-accent-hover" title={v.verified_by_name ? `By ${v.verified_by_name}` : undefined}>
              Verified business
            </span>
          )}
          {v.rereview_required && v.status === "approved" && <span className="chip font-medium bg-[#fdf6e0] text-gold-ink">Needs re-review</span>}
          <span>Listing #{v.id}</span>
        </span>
      }
      actions={
        <>
          {v.status === "approved" && (
            <Link href={`/vendors/${v.id}`} className="btn btn-secondary" target="_blank" rel="noopener noreferrer">
              Public page
            </Link>
          )}
          <Link href="/admin/vendors" className="btn btn-secondary">
            All vendors
          </Link>
        </>
      }
    >
      <div className="space-y-3 mb-4">
        {v.status_reason && ["changes_requested", "rejected", "suspended"].includes(v.status) && (
          <div className={v.status === "changes_requested" ? "alert-success" : "alert-error"} role="note">
            <p className="font-medium">
              {v.status === "changes_requested" ? "Changes requested" : v.status === "rejected" ? "Rejected" : "Suspended"}
              {v.reviewed_at ? ` ${ago(v.reviewed_at)}` : ""} · the vendor sees this note
            </p>
            <p className="mt-0.5 break-words">{v.status_reason}</p>
          </div>
        )}
        {v.rereview_required && v.status === "approved" && (
          <div className="card border-[#e8d39a] bg-[#fdf9ec]" role="note">
            <p className="font-medium">The vendor changed important details since approval</p>
            <p className="text-body text-ink-soft mt-0.5">
              {v.rereview_fields?.length ? `Changed: ${v.rereview_fields.join(", ").replace(/_/g, " ")}. ` : ""}
              The listing stays live. Check the changes, then mark the re-review done or request changes.
            </p>
          </div>
        )}
        {detail.duplicates.length > 0 && (
          <div className="card border-danger/30" role="note" data-testid="duplicate-hints">
            <p className="font-medium">Possible duplicates</p>
            <ul className="mt-1 space-y-1">
              {detail.duplicates.map((d) => (
                <li key={d.id} className="text-body">
                  <Link href={`/admin/vendors/${d.id}`} className="underline underline-offset-2 font-medium">
                    {d.name}
                  </Link>{" "}
                  <span className="text-ink-soft">
                    #{d.id} · {d.status.replace(/_/g, " ")} · same {d.match.join(" and ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4 min-w-0">
          <section className="card" aria-labelledby="profile-h">
            <h2 id="profile-h" className="text-title font-semibold">
              Profile
            </h2>
            {v.about ? (
              <p className="text-body mt-2 whitespace-pre-line break-words">{v.about}</p>
            ) : (
              <p className="text-body text-ink-soft mt-2">No description yet.</p>
            )}
            {v.tags?.length ? (
              <p className="mt-3 flex flex-wrap gap-1.5">
                {v.tags.map((t) => (
                  <span key={t} className="chip text-xs">
                    {t}
                  </span>
                ))}
              </p>
            ) : null}
            <dl className="mt-4 grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-body">
              {facts.map(([k, val]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-soft">{k}</dt>
                  <dd className="min-w-0 break-words">{val}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card" aria-labelledby="offerings-h">
            <h2 id="offerings-h" className="text-title font-semibold">
              Offerings <span className="text-ink-soft font-normal">({detail.offerings.length})</span>
            </h2>
            {detail.offerings.length === 0 ? (
              <p className="text-body text-ink-soft mt-1">No packages or services yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {detail.offerings.map((o) => (
                  <li key={o.id} className="py-2.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0">
                      <span className="block font-medium break-words">{o.title}</span>
                      <span className="block text-caption text-ink-soft">
                        {o.kind === "package" ? "Package" : o.kind === "addon" ? "Add-on" : "Service"} · {o.template_name ?? o.custom_name ?? o.category}
                        {o.custom_name && !o.template_name ? ` (custom${o.custom_status ? `, ${o.custom_status.replace(/_/g, " ")}` : ""})` : ""}
                      </span>
                      {!o.active && (
                        <span className="block text-caption text-danger">Hidden{o.hidden_reason ? `: ${o.hidden_reason}` : ""}</span>
                      )}
                    </span>
                    <span className="text-body tabular-nums shrink-0">{price(o)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="media-h">
            <h2 id="media-h" className="text-title font-semibold mb-3">
              Photos and videos <span className="text-ink-soft font-normal">({detail.media.length}{pendingMedia ? `, ${pendingMedia} waiting` : ""})</span>
            </h2>
            <MediaReview vendorId={v.id} vendorName={v.name} media={detail.media} />
          </section>

          <section className="card p-0" aria-labelledby="edit-h">
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <span>
                  <span id="edit-h" className="text-title font-semibold block">
                    Edit listing
                  </span>
                  <span className="text-caption text-ink-soft">Change details on the vendor&apos;s behalf. Every change is logged.</span>
                </span>
                <span aria-hidden="true" className="text-ink-soft transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="border-t border-line px-4 py-4 sm:px-6">
                <EditVendorForm vendorId={v.id} initial={editable} districts={options.districts} categories={options.categories} />
              </div>
            </details>
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          <section className="card" aria-labelledby="decide-h">
            <h2 id="decide-h" className="text-title font-semibold mb-3">
              Decision
            </h2>
            <DecisionPanel
              vendorId={v.id}
              name={v.name}
              status={v.status}
              actions={actions}
              verified={!!v.verified_at}
              hasVerifiedDoc={hasVerifiedDoc}
              pendingMedia={pendingMedia}
            />
          </section>

          <section className="card" aria-labelledby="owner-h">
            <h2 id="owner-h" className="text-title font-semibold">
              Owner
            </h2>
            {owner ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{owner.name}</p>
                  <p className="text-caption text-ink-soft break-all">{owner.email}</p>
                  {owner.status !== "active" && (
                    <p className="mt-1">
                      <StatusChip status={owner.status} />
                    </p>
                  )}
                </div>
                <Link href={`/admin/users/${owner.id}`} className="btn btn-secondary btn-sm min-h-11">
                  Open account
                </Link>
              </div>
            ) : (
              <div className="mt-1">
                <p className="text-body text-ink-soft mb-3">Nobody manages this listing yet. Assign it to the vendor who claimed it.</p>
                <AssignOwner vendorId={v.id} vendorName={v.name} />
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="docs-h">
            <div className="flex items-center justify-between gap-3">
              <h2 id="docs-h" className="text-title font-semibold">
                Documents
              </h2>
              <Link href={`/admin/documents?vendor=${v.id}`} className="btn btn-ghost btn-sm min-h-11">
                {pendingDocs ? `Review ${pendingDocs}` : "Open"}
              </Link>
            </div>
            {detail.documents.length === 0 ? (
              <p className="text-body text-ink-soft mt-1">No documents uploaded.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {detail.documents.map((d) => (
                  <li key={d.id} className="py-2 flex items-center justify-between gap-3 text-body">
                    <span className="min-w-0">
                      <span className="block font-medium uppercase">{d.doc_type.replace(/_/g, " ")}</span>
                      <span className="block text-caption text-ink-soft">
                        {d.number ? `${d.number} · ` : ""}
                        {d.expires_at ? `expires ${fmtDate(d.expires_at)}` : `added ${fmtDate(d.created_at)}`}
                      </span>
                    </span>
                    {d.status === "verified" && !d.valid ? (
                      <StatusChip status="rejected" label="expired" />
                    ) : (
                      <StatusChip status={d.status === "verified" ? "approved" : d.status} label={d.status} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="status-h">
            <h2 id="status-h" className="text-title font-semibold">
              Status history
            </h2>
            {detail.statusEvents.length === 0 ? (
              <p className="text-body text-ink-soft mt-1">No status changes yet.</p>
            ) : (
              <ol className="mt-2 divide-y divide-line" data-testid="status-history">
                {detail.statusEvents.map((e) => (
                  <li key={e.id} className="py-2.5 text-body">
                    <p>
                      {e.from_status.replace(/_/g, " ")} <span aria-hidden="true">→</span>
                      <span className="sr-only">to</span> <span className="font-medium">{e.to_status.replace(/_/g, " ")}</span>
                    </p>
                    {e.reason && <p className="text-ink-soft break-words">“{e.reason}”</p>}
                    <p className="text-caption text-ink-soft">
                      {fmtDateTime(e.created_at)} · {e.changed_by_name ?? "vendor or system"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="card" aria-labelledby="audit-h">
            <div className="flex items-center justify-between gap-3">
              <h2 id="audit-h" className="text-title font-semibold">
                Admin history
              </h2>
              <Link href={`/admin/audit?entity=vendor&entityId=${v.id}`} className="btn btn-ghost btn-sm min-h-11">
                Full log
              </Link>
            </div>
            {detail.auditTrail.length === 0 ? (
              <p className="text-body text-ink-soft mt-1">No admin actions on this listing yet.</p>
            ) : (
              <ol className="mt-2 divide-y divide-line" data-testid="vendor-audit">
                {detail.auditTrail.map((a) => (
                  <li key={a.id} className="py-2.5 text-body">
                    <p>
                      <span className="font-medium">{a.action}</span>{" "}
                      <span className="text-ink-soft">by {a.actor_name ?? "system"}</span>
                    </p>
                    {a.reason && <p className="text-ink-soft break-words">“{a.reason}”</p>}
                    {a.action === "vendor.edit" && <Changes before={a.before} after={a.after} />}
                    <p className="text-caption text-ink-soft">{fmtDateTime(a.created_at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </AdminPage>
  );
}
