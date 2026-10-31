"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { CustomGroup, CustomStatus, ResolveAction } from "@/lib/admin/taxonomy";
import { AdminEmptyState } from "@/app/admin/_components/admin-page";
import { ApiError, Dialog, ErrorNote, adminApi, useToast } from "../_components/ui";

interface Opt {
  id: number;
  name: string;
}
interface TplOpt extends Opt {
  category_id: number;
}

const EMPTY: Record<CustomStatus, { title: string; body: string }> = {
  pending: { title: "Nothing waiting", body: "When vendors add an “Other” offering it shows up here, grouped by name." },
  promoted: { title: "Nothing promoted yet", body: "Entries you promote into templates are listed here." },
  merged: { title: "Nothing merged yet", body: "Entries you map to an existing template are listed here." },
  kept_private: { title: "Nothing kept private", body: "Entries you leave as the vendor's own offering are listed here." },
  rejected: { title: "Nothing rejected", body: "Hidden entries are listed here with the reason you gave." },
};

function ago(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)} days ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function CustomQueue({
  status,
  groups,
  categories,
  templates,
}: {
  status: CustomStatus;
  groups: CustomGroup[];
  categories: Opt[];
  templates: TplOpt[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ group: CustomGroup; action: ResolveAction } | null>(null);
  const visible = groups.filter((g) => !handled.has(g.normalised_name));

  if (visible.length === 0) {
    return (
      <>
        <AdminEmptyState title={EMPTY[status].title} body={EMPTY[status].body} />
        {toast.node}
      </>
    );
  }

  return (
    <div className="min-w-0">
      <p className="text-body text-ink-soft">
        {visible.length} name{visible.length === 1 ? "" : "s"} · {visible.reduce((n, g) => n + g.vendor_count, 0)} vendor uses
      </p>
      <ul className="mt-3 space-y-3">
        {visible.map((g) => (
          <li key={g.normalised_name} className="card" data-testid={`custom-group-${g.normalised_name}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lead font-semibold break-words">{g.display_name}</h2>
                  <span className="chip bg-accent-tint text-accent-hover">
                    {g.vendor_count} vendor{g.vendor_count === 1 ? "" : "s"}
                  </span>
                  {status === "pending" && g.suggested && <span className="chip bg-gold/15 text-gold-ink">Worth promoting</span>}
                  {g.flagged_contact && <span className="chip bg-danger-tint text-danger">Contact details were masked</span>}
                </div>
                <p className="text-caption text-ink-soft mt-1 break-words">
                  Matches “{g.normalised_name}”
                  {g.raw_names.length > 1 && <> · spelled {g.raw_names.map((r) => `“${r}”`).join(", ")}</>}
                </p>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="text-ink-soft">Vendors</dt>
                  <dd className="min-w-0">
                    {g.sample_vendors.map((v, i) => (
                      <span key={v.id}>
                        {i > 0 && ", "}
                        <Link href={`/admin/vendors/${v.id}`} className="underline underline-offset-2 hover:text-accent">
                          {v.name}
                        </Link>
                      </span>
                    ))}
                    {g.vendor_count > g.sample_vendors.length && (
                      <span className="text-ink-soft"> and {g.vendor_count - g.sample_vendors.length} more</span>
                    )}
                  </dd>
                  <dt className="text-ink-soft">Filed under</dt>
                  <dd>{g.categories.map((c) => `${c.name}${g.categories.length > 1 ? ` (${c.count})` : ""}`).join(", ")}</dd>
                  <dt className="text-ink-soft">First seen</dt>
                  <dd>{ago(g.oldest_at)}</dd>
                  {g.matching_templates.length > 0 && status === "pending" && (
                    <>
                      <dt className="text-ink-soft">Similar template</dt>
                      <dd>{g.matching_templates.map((t) => t.name).join(", ")}</dd>
                    </>
                  )}
                </dl>
              </div>
              {status === "pending" && (
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:w-64 lg:shrink-0 lg:justify-end">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ group: g, action: "promote" })}>
                    Promote<span className="sr-only"> {g.display_name}</span>
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ group: g, action: "merge" })}>
                    Merge<span className="sr-only"> {g.display_name}</span>
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ group: g, action: "keep_private" })}>
                    Keep private<span className="sr-only"> {g.display_name}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-danger hover:bg-danger-tint"
                    onClick={() => setDialog({ group: g, action: "reject" })}
                  >
                    Reject<span className="sr-only"> {g.display_name}</span>
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {dialog && (
        <ResolveDialog
          key={`${dialog.group.normalised_name}-${dialog.action}`}
          group={dialog.group}
          action={dialog.action}
          categories={categories}
          templates={templates}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setHandled((s) => new Set(s).add(dialog.group.normalised_name));
            setDialog(null);
            toast.show(msg);
            router.refresh();
          }}
        />
      )}
      {toast.node}
    </div>
  );
}

const TITLES: Record<ResolveAction, string> = {
  promote: "Promote to a template",
  merge: "Merge into a template",
  keep_private: "Keep private",
  reject: "Reject and hide",
};

function ResolveDialog({
  group,
  action,
  categories,
  templates,
  onClose,
  onDone,
}: {
  group: CustomGroup;
  action: ResolveAction;
  categories: Opt[];
  templates: TplOpt[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const topCategory = group.categories[0]?.id;
  const [name, setName] = useState(() => {
    const n = group.display_name.replace(/[!?.]+$/, "").trim();
    return n.charAt(0).toUpperCase() + n.slice(1);
  });
  const [categoryId, setCategoryId] = useState<number>(
    categories.some((c) => c.id === topCategory) ? topCategory! : categories[0]?.id ?? 0
  );
  const [templateId, setTemplateId] = useState<number>(group.matching_templates[0]?.id ?? 0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const grouped = useMemo(() => {
    const m = new Map<number, TplOpt[]>();
    for (const t of templates) m.set(t.category_id, [...(m.get(t.category_id) ?? []), t]);
    return [...m.entries()].filter(([cid]) => catName.has(cid));
  }, [templates, catName]);

  const n = group.request_count;
  const offerings = `${n} offering${n === 1 ? "" : "s"} from ${group.vendor_count} vendor${group.vendor_count === 1 ? "" : "s"}`;
  const description: Record<ResolveAction, string> = {
    promote: `Creates a new standard offering and moves ${offerings} onto it in one step. It becomes a search filter straight away.`,
    merge: `Moves ${offerings} onto an existing template.`,
    keep_private: `Leaves ${offerings} as the vendors' own custom offering. It stays on their profiles and in text search, but not as a filter.`,
    reject: `Hides ${offerings} from customers and tells each vendor why.`,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { action, ids: group.request_ids, normalisedName: group.normalised_name };
    if (action === "promote") {
      if (!name.trim()) return setError("Give the template a name.");
      body.newTemplate = { name: name.trim(), categoryId };
    }
    if (action === "merge") {
      if (!templateId) return setError("Pick a template.");
      body.templateId = templateId;
    }
    if (action === "reject") {
      if (reason.trim().length < 3) return setError("Tell the vendor why (at least 3 characters).");
      body.reason = reason.trim();
    }
    if (action === "keep_private" && reason.trim()) body.reason = reason.trim();
    setBusy(true);
    try {
      const r = await adminApi<{ template: { name: string } | null; affected_offerings: number }>(
        "/api/admin/custom-offerings/resolve",
        { body }
      );
      const msgs: Record<ResolveAction, string> = {
        promote: `Promoted “${r.template?.name}”. ${r.affected_offerings} offering${r.affected_offerings === 1 ? "" : "s"} moved.`,
        merge: `Merged into “${r.template?.name}”.`,
        keep_private: `“${group.display_name}” stays private.`,
        reject: `Rejected “${group.display_name}”. Vendors were told why.`,
      };
      onDone(msgs[action]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <Dialog open title={`${TITLES[action]}: ${group.display_name}`} description={description[action]} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {action === "promote" && (
          <>
            <div>
              <label className="label" htmlFor="promote-name">
                Template name
              </label>
              <input id="promote-name" className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <p className="hint">Vendors keep their own title; this is the name customers filter by.</p>
            </div>
            <div>
              <label className="label" htmlFor="promote-cat">
                Category
              </label>
              <select id="promote-cat" className="field" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="hint">Price units and attributes start from the category; edit them later in Taxonomy.</p>
            </div>
          </>
        )}
        {action === "merge" && (
          <div>
            <label className="label" htmlFor="merge-tpl">
              Template
            </label>
            <select id="merge-tpl" className="field" value={templateId} onChange={(e) => setTemplateId(Number(e.target.value))}>
              <option value={0}>Choose a template…</option>
              {grouped.map(([cid, list]) => (
                <optgroup key={cid} label={catName.get(cid)}>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        {(action === "reject" || action === "keep_private") && (
          <div>
            <label className="label" htmlFor="resolve-reason">
              {action === "reject" ? "Reason (sent to the vendor)" : "Note (optional, for the audit log)"}
            </label>
            <textarea
              id="resolve-reason"
              className="field"
              rows={3}
              maxLength={1000}
              required={action === "reject"}
              aria-invalid={!!error && action === "reject" && reason.trim().length < 3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={action === "reject" ? "e.g. This isn't an event service we list." : ""}
            />
          </div>
        )}
        <ErrorNote message={error} />
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            className={`btn btn-primary ${action === "reject" ? "bg-danger hover:!bg-danger" : ""}`}
            disabled={busy}
          >
            {busy ? "Saving…" : TITLES[action]}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
