"use client";

import { useCallback, useMemo, useState } from "react";
import type { AdminCategory, AdminEventType, AdminTemplate } from "@/lib/admin/taxonomy";
import { ATTRIBUTE_TYPES, type AttributeField, type AttributeType } from "@/lib/offering-validation";
import { ApiError, Dialog, ErrorNote, StatusChip, UnitPicker, adminApi, unitLabel, useToast } from "./ui";

export type TaxTab = "categories" | "templates" | "event-types";

interface Data {
  categories: AdminCategory[];
  templates: AdminTemplate[];
  eventTypes: AdminEventType[];
}

const TAB_LABELS: Record<TaxTab, string> = {
  categories: "Categories",
  templates: "Offering templates",
  "event-types": "Event types",
};

const TYPE_LABELS: Record<AttributeType, string> = {
  int: "Whole number",
  number: "Number",
  bool: "Yes / no",
  text: "Text",
  enum: "One of a list",
  multi: "Several from a list",
  tags: "Free tags",
};

export function TaxonomyManager({
  initialTab,
  initialCategoryId,
  initial,
}: {
  initialTab: TaxTab;
  initialCategoryId: number | null;
  initial: Data;
}) {
  const [tab, setTab] = useState<TaxTab>(initialTab);
  const [data, setData] = useState<Data>(initial);
  const [catFilter, setCatFilter] = useState<number>(
    initialCategoryId ?? initial.categories.find((c) => c.active)?.id ?? initial.categories[0]?.id ?? 0
  );
  const toast = useToast();

  const reload = useCallback(async () => {
    const [c, t, e] = await Promise.all([
      adminApi<{ categories: AdminCategory[] }>("/api/admin/categories"),
      adminApi<{ templates: AdminTemplate[] }>("/api/admin/templates"),
      adminApi<{ eventTypes: AdminEventType[] }>("/api/admin/event-types"),
    ]);
    setData({ categories: c.categories, templates: t.templates, eventTypes: e.eventTypes });
  }, []);

  const done = useCallback(
    async (msg: string) => {
      toast.show(msg);
      await reload().catch(() => toast.show(`${msg} Refresh the page to see the latest list.`));
    },
    [reload, toast]
  );

  const selectTab = (t: TaxTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };

  const openTemplates = (categoryId: number) => {
    setCatFilter(categoryId);
    selectTab("templates");
  };

  return (
    <div className="min-w-0">
      <div role="tablist" aria-label="Taxonomy sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {(Object.keys(TAB_LABELS) as TaxTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => selectTab(t)}
            className={`min-h-[44px] shrink-0 border-b-2 px-3 text-sm font-medium ${
              tab === t ? "border-accent text-accent" : "border-transparent text-ink-soft hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === "categories" && <CategoriesPanel data={data} onDone={done} onOpenTemplates={openTemplates} />}
        {tab === "templates" && <TemplatesPanel data={data} categoryId={catFilter} onCategory={setCatFilter} onDone={done} />}
        {tab === "event-types" && <EventTypesPanel data={data} onDone={done} />}
      </div>
      {toast.node}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoriesPanel({
  data,
  onDone,
  onOpenTemplates,
}: {
  data: Data;
  onDone: (msg: string) => Promise<void>;
  onOpenTemplates: (id: number) => void;
}) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [retiring, setRetiring] = useState<AdminCategory | null>(null);
  const icons = useMemo(
    () => [...new Set(data.categories.map((c) => c.icon).filter((x): x is string => !!x))].sort(),
    [data.categories]
  );

  return (
    <section aria-label="Categories">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-soft">
          {data.categories.filter((c) => c.active).length} active · {data.categories.filter((c) => !c.active).length} retired
        </p>
        {editing !== "new" && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            Add category
          </button>
        )}
      </div>
      <datalist id="tax-icons">
        {icons.map((i) => (
          <option key={i} value={i} />
        ))}
      </datalist>

      {editing === "new" && (
        <div className="card mt-4">
          <h2 className="text-title font-semibold">New category</h2>
          <CategoryForm
            onCancel={() => setEditing(null)}
            onSaved={async (c) => {
              setEditing(null);
              await onDone(`Added "${c.display_name}".`);
            }}
          />
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {data.categories.map((c) => (
          <li key={c.id} className={`card ${c.active ? "" : "bg-surface-muted"}`} data-testid={`category-${c.slug}`}>
            {editing === c.id ? (
              <>
                <h2 className="text-title font-semibold">Edit {c.display_name}</h2>
                <CategoryForm
                  category={c}
                  onCancel={() => setEditing(null)}
                  onSaved={async (n) => {
                    setEditing(null);
                    await onDone(`Saved "${n.display_name}".`);
                  }}
                />
              </>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lead font-semibold">{c.display_name}</h2>
                    <StatusChip active={c.active} />
                  </div>
                  <p className="text-caption text-ink-soft mt-0.5 break-words">
                    {c.slug}
                    {c.icon ? ` · icon ${c.icon}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.allowed_price_units.map((u) => (
                      <span key={u} className={`chip ${u === c.default_price_unit ? "bg-accent-tint text-accent-hover" : ""}`}>
                        {unitLabel(u)}
                        {u === c.default_price_unit && <span className="sr-only"> (default)</span>}
                      </span>
                    ))}
                    {c.allow_on_request && <span className="chip">price on request</span>}
                  </div>
                  <p className="text-caption text-ink-soft mt-2">
                    {c.active_offerings} active offering{c.active_offerings === 1 ? "" : "s"} ·{" "}
                    <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onOpenTemplates(c.id)}>
                      {c.template_count} template{c.template_count === 1 ? "" : "s"}
                    </button>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(c.id)}>
                    Edit<span className="sr-only"> {c.display_name}</span>
                  </button>
                  {c.active ? (
                    <button type="button" className="btn btn-ghost btn-sm text-danger hover:bg-danger-tint" onClick={() => setRetiring(c)}>
                      Retire<span className="sr-only"> {c.display_name}</span>
                    </button>
                  ) : (
                    <ActivateButton
                      label={c.display_name}
                      path={`/api/admin/categories/${c.id}`}
                      onDone={() => onDone(`"${c.display_name}" is active again.`)}
                    />
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmRetire
        open={!!retiring}
        title={`Retire ${retiring?.display_name ?? ""}?`}
        body={
          retiring && retiring.active_offerings > 0 ? (
            <>
              <strong>{retiring.active_offerings}</strong> active offering{retiring.active_offerings === 1 ? "" : "s"} still use this
              category, so it can&apos;t be retired yet.
            </>
          ) : (
            "Vendors won't be able to pick it and it disappears from search filters. You can activate it again later."
          )
        }
        path={retiring ? `/api/admin/categories/${retiring.id}` : ""}
        onClose={() => setRetiring(null)}
        onDone={async () => {
          const name = retiring?.display_name;
          setRetiring(null);
          await onDone(`Retired "${name}".`);
        }}
      />
    </section>
  );
}

function CategoryForm({
  category,
  onCancel,
  onSaved,
}: {
  category?: AdminCategory;
  onCancel: () => void;
  onSaved: (c: AdminCategory) => Promise<void>;
}) {
  const p = `cat-${category?.id ?? "new"}`;
  const [name, setName] = useState(category?.display_name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [units, setUnits] = useState<string[]>(category?.allowed_price_units ?? ["event"]);
  const [def, setDef] = useState(category?.default_price_unit ?? "event");
  const [onReq, setOnReq] = useState(category?.allow_on_request ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the category a name.");
    if (!units.length) return setError("Pick at least one price unit.");
    setBusy(true);
    setError(null);
    try {
      const body = {
        displayName: name,
        icon: icon.trim() || null,
        description,
        allowedPriceUnits: units,
        defaultPriceUnit: def,
        allowOnRequest: onReq,
      };
      const r = category
        ? await adminApi<{ category: AdminCategory }>(`/api/admin/categories/${category.id}`, { method: "PATCH", body })
        : await adminApi<{ category: AdminCategory }>("/api/admin/categories", { body });
      await onSaved(r.category);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${p}-name`}>
            Display name
          </label>
          <input id={`${p}-name`} className="field" value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
          {category && <p className="hint">Slug {category.slug} stays the same so links keep working.</p>}
        </div>
        <div>
          <label className="label" htmlFor={`${p}-icon`}>
            Icon
          </label>
          <input
            id={`${p}-icon`}
            className="field"
            value={icon}
            list="tax-icons"
            maxLength={30}
            placeholder="e.g. camera"
            autoCapitalize="none"
            onChange={(e) => setIcon(e.target.value.toLowerCase())}
          />
          <p className="hint">Short icon name: lower-case letters, numbers and dashes.</p>
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${p}-desc`}>
          Description <span className="font-normal text-ink-soft">(optional)</span>
        </label>
        <textarea id={`${p}-desc`} className="field" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <UnitPicker
        idPrefix={p}
        units={units}
        def={def}
        onChange={(u, d) => {
          setUnits(u);
          setDef(d);
        }}
      />
      <label className="flex min-h-[44px] items-center gap-3 text-sm">
        <input type="checkbox" className="h-5 w-5 accent-[var(--color-accent)]" checked={onReq} onChange={(e) => setOnReq(e.target.checked)} />
        Allow &ldquo;price on request&rdquo; in this category
      </label>
      <ErrorNote message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : category ? "Save changes" : "Add category"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ActivateButton({ label, path, onDone }: { label: string; path: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await adminApi(path, { method: "PATCH", body: { active: true } });
            await onDone();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not activate.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Activating…" : "Activate"}
        <span className="sr-only"> {label}</span>
      </button>
      <ErrorNote message={error} />
    </div>
  );
}

function ConfirmRetire({
  open,
  title,
  body,
  path,
  onClose,
  onDone,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  path: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} title={title} onClose={close}>
      <p className="text-body">{body}</p>
      <ErrorNote message={error} />
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary bg-danger hover:!bg-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await adminApi(path, { method: "PATCH", body: { active: false } });
              await onDone();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Could not retire.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Retiring…" : "Retire"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Offering templates
// ---------------------------------------------------------------------------

function TemplatesPanel({
  data,
  categoryId,
  onCategory,
  onDone,
}: {
  data: Data;
  categoryId: number;
  onCategory: (id: number) => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<AdminTemplate | "new" | null>(null);
  const category = data.categories.find((c) => c.id === categoryId);
  const list = data.templates.filter((t) => t.category_id === categoryId);

  return (
    <section aria-label="Offering templates">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-80">
          <label className="label" htmlFor="tpl-cat">
            Category
          </label>
          <select id="tpl-cat" className="field" value={categoryId} onChange={(e) => onCategory(Number(e.target.value))}>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
                {c.active ? "" : " (retired)"}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing("new")} disabled={!category?.active}>
          Add template
        </button>
      </div>
      {category && !category.active && (
        <p className="alert-error mt-3">This category is retired. Activate it to add or re-activate templates.</p>
      )}

      {list.length === 0 ? (
        <div className="card mt-4">
          <h2 className="text-title font-semibold">No templates yet</h2>
          <p className="text-body text-ink-soft mt-1">
            Vendors in {category?.display_name ?? "this category"} can only add &ldquo;Other&rdquo; offerings until you add a template.
          </p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {list.map((t) => (
            <li key={t.id} className={`card flex flex-col gap-3 ${t.active ? "" : "bg-surface-muted"}`} data-testid={`template-${t.code}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lead font-semibold break-words">{t.name}</h2>
                  <StatusChip active={t.active} />
                  {t.is_core && <span className="chip">core</span>}
                  {t.kind === "addon" && <span className="chip">add-on</span>}
                </div>
                <p className="text-caption text-ink-soft mt-0.5 break-words">
                  {t.code} · {t.allowed_price_units.map(unitLabel).join(", ")} · {t.attribute_schema.length} attribute
                  {t.attribute_schema.length === 1 ? "" : "s"}
                </p>
                <p className="text-caption mt-1">
                  {t.offering_count} offering{t.offering_count === 1 ? "" : "s"}
                  {!t.active && t.offering_count > 0 && (
                    <span className="text-gold-ink"> still use it (they keep working; vendors can&apos;t pick it for new ones)</span>
                  )}
                </p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(t)}>
                  Edit<span className="sr-only"> {t.name}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <TemplateEditor
        key={editing === "new" ? `new-${categoryId}` : editing?.id ?? "none"}
        open={!!editing}
        template={editing === "new" ? null : editing}
        category={category}
        onClose={() => setEditing(null)}
        onSaved={async (msg) => {
          setEditing(null);
          await onDone(msg);
        }}
      />
    </section>
  );
}

interface Row extends Omit<AttributeField, "options"> {
  uid: string;
  options: string;
  /** Key existed when the editor opened and offerings use the template. */
  locked: boolean;
}

let rowSeq = 0;
const toRow = (f: AttributeField, locked: boolean): Row => ({
  ...f,
  uid: `r${++rowSeq}`,
  options: (f.options ?? []).join(", "),
  locked,
});

function TemplateEditor({
  open,
  template,
  category,
  onClose,
  onSaved,
}: {
  open: boolean;
  template: AdminTemplate | null;
  category?: AdminCategory;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
}) {
  const inUse = (template?.offering_count ?? 0) > 0;
  const base = template ?? null;
  const p = `tpl-${template?.id ?? "new"}`;
  const [name, setName] = useState(base?.name ?? "");
  const [units, setUnits] = useState<string[]>(base?.allowed_price_units ?? category?.allowed_price_units ?? ["event"]);
  const [def, setDef] = useState(base?.default_price_unit ?? category?.default_price_unit ?? "event");
  const [onReq, setOnReq] = useState(base?.allow_on_request ?? category?.allow_on_request ?? false);
  const [core, setCore] = useState(base?.is_core ?? false);
  const [rows, setRows] = useState<Row[]>(() =>
    (base?.attribute_schema ?? category?.attribute_schema ?? []).map((f) => toRow(f, inUse))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchRow = (uid: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the template a name.");
    if (!units.length) return setError("Pick at least one price unit.");
    setBusy(true);
    setError(null);
    const attributeSchema = rows.map((r) => ({
      key: r.key.trim(),
      label: r.label.trim(),
      type: r.type,
      ...(r.type === "enum" || r.type === "multi"
        ? { options: r.options.split(",").map((o) => o.trim()).filter(Boolean) }
        : {}),
      required: !!r.required,
      filterable: !!r.filterable,
      ...(r.min !== undefined ? { min: r.min } : {}),
      ...(r.max !== undefined ? { max: r.max } : {}),
    }));
    const body = { name, allowedPriceUnits: units, defaultPriceUnit: def, allowOnRequest: onReq, isCore: core, attributeSchema };
    try {
      if (template) {
        await adminApi(`/api/admin/templates/${template.id}`, { method: "PATCH", body });
        await onSaved(`Saved "${name.trim()}".`);
      } else {
        await adminApi("/api/admin/templates", { body: { ...body, categoryId: category?.id } });
        await onSaved(`Added "${name.trim()}". Vendors can pick it now.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active: boolean) => {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi(`/api/admin/templates/${template.id}`, { method: "PATCH", body: { active } });
      await onSaved(active ? `"${template.name}" is active again.` : `Retired "${template.name}".`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      wide
      title={template ? `Edit ${template.name}` : `New template in ${category?.display_name ?? ""}`}
      description={
        inUse
          ? `${template!.offering_count} offering${template!.offering_count === 1 ? " uses" : "s use"} this template, so existing attribute keys are locked. You can still change labels, options and add new attributes.`
          : "Templates are the standard offerings vendors pick from."
      }
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor={`${p}-name`}>
              Name
            </label>
            <input id={`${p}-name`} className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            {template && <p className="hint">Code {template.code} doesn&apos;t change.</p>}
          </div>
          <div className="flex flex-col justify-end gap-1">
            <label className="flex min-h-[44px] items-center gap-3 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-[var(--color-accent)]" checked={onReq} onChange={(e) => setOnReq(e.target.checked)} />
              Allow &ldquo;price on request&rdquo;
            </label>
            <label className="flex min-h-[44px] items-center gap-3 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-[var(--color-accent)]" checked={core} onChange={(e) => setCore(e.target.checked)} />
              Core unit (shows in the event-management checklist)
            </label>
          </div>
        </div>
        <UnitPicker
          idPrefix={p}
          units={units}
          def={def}
          onChange={(u, d) => {
            setUnits(u);
            setDef(d);
          }}
        />

        <fieldset>
          <legend className="label">Attributes</legend>
          <p className="hint -mt-1 mb-3">Fields vendors fill in for this offering. Filterable ones become search filters.</p>
          {rows.length === 0 && <p className="text-body text-ink-soft">No attributes yet.</p>}
          <ol className="space-y-3">
            {rows.map((r, i) => (
              <li key={r.uid} className="rounded-control border border-line p-3" data-testid="attr-row">
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
                  <div>
                    <label className="label" htmlFor={`${r.uid}-key`}>
                      Key
                    </label>
                    <input
                      id={`${r.uid}-key`}
                      className="field font-mono"
                      value={r.key}
                      readOnly={r.locked}
                      aria-readonly={r.locked}
                      aria-describedby={r.locked ? `${r.uid}-lock` : undefined}
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={41}
                      onChange={(e) => patchRow(r.uid, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                    />
                    {r.locked && (
                      <p id={`${r.uid}-lock`} className="hint">
                        In use: locked
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label" htmlFor={`${r.uid}-label`}>
                      Label
                    </label>
                    <input
                      id={`${r.uid}-label`}
                      className="field"
                      value={r.label}
                      maxLength={80}
                      onChange={(e) => patchRow(r.uid, { label: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor={`${r.uid}-type`}>
                      Type
                    </label>
                    <select
                      id={`${r.uid}-type`}
                      className="field"
                      value={r.type}
                      disabled={r.locked}
                      onChange={(e) => patchRow(r.uid, { type: e.target.value as AttributeType })}
                    >
                      {ATTRIBUTE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {(r.type === "enum" || r.type === "multi") && (
                  <div className="mt-3">
                    <label className="label" htmlFor={`${r.uid}-opts`}>
                      Options <span className="font-normal text-ink-soft">(comma separated)</span>
                    </label>
                    <input
                      id={`${r.uid}-opts`}
                      className="field"
                      value={r.options}
                      onChange={(e) => patchRow(r.uid, { options: e.target.value })}
                    />
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-5">
                  <label className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[var(--color-accent)]"
                      checked={!!r.required}
                      onChange={(e) => patchRow(r.uid, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  <label className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[var(--color-accent)]"
                      checked={!!r.filterable}
                      onChange={(e) => patchRow(r.uid, { filterable: e.target.checked })}
                    />
                    Filterable
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm ml-auto text-danger hover:bg-danger-tint"
                    disabled={r.locked}
                    title={r.locked ? "Offerings use this key" : undefined}
                    onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}
                  >
                    Remove<span className="sr-only"> attribute {i + 1}</span>
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3"
            onClick={() => setRows((rs) => [...rs, toRow({ key: "", label: "", type: "text" }, false)])}
          >
            Add attribute
          </button>
        </fieldset>

        <ErrorNote message={error} />
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : template ? "Save template" : "Add template"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {template &&
            (template.active ? (
              <button
                type="button"
                className="btn btn-ghost text-danger hover:bg-danger-tint sm:ml-auto"
                disabled={busy}
                onClick={() => setActive(false)}
              >
                Retire template
              </button>
            ) : (
              <button type="button" className="btn btn-secondary sm:ml-auto" disabled={busy} onClick={() => setActive(true)}>
                Activate template
              </button>
            ))}
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Event types and bundles
// ---------------------------------------------------------------------------

function EventTypesPanel({ data, onDone }: { data: Data; onDone: (msg: string) => Promise<void> }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const catName = useMemo(() => new Map(data.categories.map((c) => [c.id, c.display_name])), [data.categories]);

  return (
    <section aria-label="Event types">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-soft max-w-prose">
          Each event type has a &ldquo;what you need&rdquo; bundle of categories. Core ones are shown first to customers.
        </p>
        {editing !== "new" && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            Add event type
          </button>
        )}
      </div>
      {editing === "new" && (
        <div className="card mt-4">
          <h2 className="text-title font-semibold">New event type</h2>
          <EventTypeForm
            categories={data.categories}
            onCancel={() => setEditing(null)}
            onSaved={async (n) => {
              setEditing(null);
              await onDone(`Added "${n}".`);
            }}
          />
        </div>
      )}
      <ul className="mt-4 space-y-3">
        {data.eventTypes.map((e) => (
          <li key={e.id} className={`card ${e.active ? "" : "bg-surface-muted"}`} data-testid={`event-type-${e.slug}`}>
            {editing === e.id ? (
              <>
                <h2 className="text-title font-semibold">Edit {e.name}</h2>
                <EventTypeForm
                  eventType={e}
                  categories={data.categories}
                  onCancel={() => setEditing(null)}
                  onSaved={async (n) => {
                    setEditing(null);
                    await onDone(`Saved "${n}".`);
                  }}
                />
              </>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lead font-semibold">{e.name}</h2>
                    <StatusChip active={e.active} />
                    {e.community && <span className="chip">{e.community}</span>}
                  </div>
                  <p className="text-caption text-ink-soft mt-0.5">{e.slug}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.categories.length === 0 && <span className="text-caption text-ink-soft">No bundle yet</span>}
                    {e.categories.map((c) => (
                      <span key={c.category_id} className={`chip ${c.is_core ? "bg-accent-tint text-accent-hover" : ""}`}>
                        {catName.get(c.category_id) ?? `#${c.category_id}`}
                        {!c.is_core && <span className="text-ink-soft"> · optional</span>}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(e.id)}>
                    Edit<span className="sr-only"> {e.name}</span>
                  </button>
                  <ToggleActive
                    active={e.active}
                    label={e.name}
                    path={`/api/admin/event-types/${e.id}`}
                    onDone={(active) => onDone(active ? `"${e.name}" is active again.` : `Retired "${e.name}".`)}
                  />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ToggleActive({
  active,
  label,
  path,
  onDone,
}: {
  active: boolean;
  label: string;
  path: string;
  onDone: (active: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className={active ? "btn btn-ghost btn-sm text-danger hover:bg-danger-tint" : "btn btn-secondary btn-sm"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await adminApi(path, { method: "PATCH", body: { active: !active } });
            await onDone(!active);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not save.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : active ? "Retire" : "Activate"}
        <span className="sr-only"> {label}</span>
      </button>
      <ErrorNote message={error} />
    </div>
  );
}

function EventTypeForm({
  eventType,
  categories,
  onCancel,
  onSaved,
}: {
  eventType?: AdminEventType;
  categories: AdminCategory[];
  onCancel: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const p = `et-${eventType?.id ?? "new"}`;
  const [name, setName] = useState(eventType?.name ?? "");
  const [community, setCommunity] = useState(eventType?.community ?? "");
  const [bundle, setBundle] = useState<Map<number, boolean>>(
    () => new Map((eventType?.categories ?? []).map((c) => [c.category_id, c.is_core]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = categories.filter((c) => c.active || bundle.has(c.id));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the event type a name.");
    setBusy(true);
    setError(null);
    // Core categories first, then optional, each in catalogue order.
    const ordered = choices
      .filter((c) => bundle.has(c.id))
      .sort((a, b) => Number(bundle.get(b.id)) - Number(bundle.get(a.id)))
      .map((c) => ({ categoryId: c.id, isCore: bundle.get(c.id)! }));
    const body = { name, community: community.trim() || null, categories: ordered };
    try {
      if (eventType) await adminApi(`/api/admin/event-types/${eventType.id}`, { method: "PATCH", body });
      else await adminApi("/api/admin/event-types", { body });
      await onSaved(name.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${p}-name`}>
            Name
          </label>
          <input id={`${p}-name`} className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`${p}-comm`}>
            Community <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input
            id={`${p}-comm`}
            className="field"
            value={community}
            maxLength={40}
            placeholder="e.g. hindu, christian, muslim"
            onChange={(e) => setCommunity(e.target.value)}
          />
        </div>
      </div>
      <fieldset>
        <legend className="label">What you need (bundle)</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {choices.map((c) => {
            const on = bundle.has(c.id);
            return (
              <li key={c.id} className={`flex flex-wrap items-center gap-x-3 rounded-control border px-3 ${on ? "border-accent" : "border-line"}`}>
                <label className="flex min-h-[44px] flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--color-accent)]"
                    checked={on}
                    onChange={(e) =>
                      setBundle((m) => {
                        const n = new Map(m);
                        if (e.target.checked) n.set(c.id, true);
                        else n.delete(c.id);
                        return n;
                      })
                    }
                  />
                  {c.display_name}
                </label>
                {on && (
                  <label className="flex min-h-[44px] items-center gap-2 text-caption text-ink-soft">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-accent)]"
                      checked={!!bundle.get(c.id)}
                      onChange={(e) => setBundle((m) => new Map(m).set(c.id, e.target.checked))}
                    />
                    Core<span className="sr-only"> for {c.display_name}</span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <ErrorNote message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : eventType ? "Save changes" : "Add event type"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
