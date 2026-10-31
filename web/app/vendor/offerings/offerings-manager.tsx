"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Chip, api, offeringChips, type Offering, type PackageItem } from "@/app/vendor/_components/offering-api";

// /vendor/offerings list (P0-11): tabs for offerings, packages and add-ons,
// grouped by category, with on/off, reorder and delete. Editing happens on
// /vendor/offerings/[id] and /vendor/offerings/packages/[id].

type Tab = "units" | "packages" | "addons";
const TABS: { id: Tab; label: string }[] = [
  { id: "units", label: "Offerings" },
  { id: "packages", label: "Packages" },
  { id: "addons", label: "Add-ons" },
];

export default function OfferingsManager({
  initialOfferings,
  initialItems,
  limit,
  vendorId,
}: {

  initialOfferings: Offering[];
  initialItems: PackageItem[];
  limit: number;
  vendorId: number;
}) {
  const [offerings, setOfferings] = useState(initialOfferings);
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<Tab>("units");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ units: null, packages: null, addons: null });

  const byKind = useMemo(
    () => ({
      units: offerings.filter((o) => o.kind === "unit"),
      packages: offerings.filter((o) => o.kind === "package"),
      addons: offerings.filter((o) => o.kind === "addon"),
    }),
    [offerings]
  );

  async function reload() {
    const r = await api<{ offerings: Offering[]; packageItems: PackageItem[] }>("/api/vendor/offerings");
    if (r.ok) {
      setOfferings(r.data.offerings);
      setItems(r.data.packageItems);
    }
  }

  async function toggle(o: Offering) {
    setNotice(null);
    if (o.needs_price) {
      setNotice({ tone: "error", text: `Add a price to “${o.title}” before turning it on.` });
      return;
    }
    const turningOff = o.active;
    if (turningOff && o.kind !== "package") {
      const used = items.filter((i) => i.item_id === o.id).map((i) => offerings.find((p) => p.id === i.package_id)?.title);
      if (used.length && !window.confirm(`“${o.title}” is in ${used.length === 1 ? "a package" : `${used.length} packages`} (${used.join(", ")}). Turning it off hides ${used.length === 1 ? "that package" : "those packages"} until you turn it back on. Continue?`)) {
        return;
      }
    }
    setBusyId(o.id);
    const r = await api(`/api/vendor/offerings/${o.id}`, "PATCH", { active: !o.active });
    setBusyId(null);
    if (!r.ok) return setNotice({ tone: "error", text: r.error });
    await reload();
    setNotice({ tone: "ok", text: `${o.title} is now ${turningOff ? "off" : "on"}.` });
  }

  async function remove(o: Offering) {
    setNotice(null);
    if (!window.confirm(`Delete “${o.title}”? This can't be undone.`)) return;
    setBusyId(o.id);
    const r = await api<{ mode: string }>(`/api/vendor/offerings/${o.id}`, "DELETE");
    setBusyId(null);
    if (!r.ok) return setNotice({ tone: "error", text: r.error });
    await reload();
    setNotice({
      tone: "ok",
      text:
        r.data.mode === "deactivated"
          ? `${o.title} has enquiries, so it was turned off instead of deleted.`
          : `${o.title} was deleted.`,
    });
  }

  async function move(list: Offering[], index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const ordered = [...list];
    [ordered[index], ordered[j]] = [ordered[j], ordered[index]];
    // Swap within the same slots of the full list, so other groups keep their place.
    const ids = new Set(ordered.map((o) => o.id));
    let k = 0;
    const next = offerings.map((o) => (ids.has(o.id) ? ordered[k++] : o));
    setOfferings(next.map((o, i) => ({ ...o, sort_order: i })));
    const r = await api("/api/vendor/offerings/reorder", "POST", { ids: next.map((o) => o.id) });
    if (!r.ok) {
      setNotice({ tone: "error", text: r.error });
      await reload();
    }
  }

  function onTabKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(n);
    tabRefs.current[n]?.focus();
  }

  const list = byKind[tab];
  const groups = useMemo(() => {
    const m = new Map<string, Offering[]>();
    for (const o of list) {
      const k = o.category;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(o);
    }
    return [...m.entries()];
  }, [list]);

  const row = (o: Offering, index: number, all: Offering[]) => {
    const pkgItems = o.kind === "package" ? items.filter((i) => i.package_id === o.id) : [];
    const parent = o.parent_service_id ? offerings.find((p) => p.id === o.parent_service_id) : null;
    const editHref = o.kind === "package" ? `/vendor/offerings/packages/${o.id}` : `/vendor/offerings/${o.id}`;
    const busy = busyId === o.id;
    return (
      <li key={o.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${!o.active ? "bg-surface-muted/60" : ""}`}>
        <div className="flex-1 min-w-0">
          <Link href={editHref} className="font-medium hover:text-accent hover:underline underline-offset-2">
            {o.title}
          </Link>
          <p className="text-body text-ink-soft">
            {o.needs_price ? "No price yet" : o.price_label}
            {parent ? ` · add-on to ${parent.title}` : ""}
          </p>
          {pkgItems.length > 0 && (
            <p className="text-caption text-ink-soft mt-0.5 truncate">
              Includes: {pkgItems.map((i) => `${Number(i.qty) !== 1 ? `${Number(i.qty)} × ` : ""}${i.title}${i.active ? "" : " (off)"}`).join(", ")}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {offeringChips(o).map((c) => (
              <Chip key={c.label} {...c} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <span className="inline-flex">
            <button
              type="button"
              className="btn btn-ghost btn-sm !px-2.5"
              aria-label={`Move ${o.title} up`}
              disabled={index === 0}
              onClick={() => void move(all, index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm !px-2.5"
              aria-label={`Move ${o.title} down`}
              disabled={index === all.length - 1}
              onClick={() => void move(all, index, 1)}
            >
              ↓
            </button>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={o.active}
            aria-label={`Show ${o.title} on my profile`}
            disabled={busy}
            onClick={() => void toggle(o)}
            className="btn btn-secondary btn-sm"
          >
            <span
              className={`relative inline-block h-5 w-9 rounded-full transition-colors ${o.active ? "bg-accent" : "bg-line-strong"}`}
              aria-hidden
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${o.active ? "left-4.5" : "left-0.5"}`} />
            </span>
            {o.active ? "On" : "Off"}
          </button>
          <Link href={editHref} className="btn btn-secondary btn-sm">
            Edit
          </Link>
          <button type="button" className="btn btn-ghost btn-sm !text-danger" disabled={busy} onClick={() => void remove(o)}>
            Delete
          </button>
        </div>
      </li>
    );
  };

  const empty: Record<Tab, { title: string; body: string; href: string; cta: string }> = {
    units: {
      title: "No offerings yet",
      body: "Add what you sell (e.g. Wedding photography, Kerala sadhya) with a starting price.",
      href: "/vendor/offerings/new",
      cta: "Add an offering",
    },
    packages: {
      title: "No packages yet",
      body: "Bundle your units into one price, e.g. Hindu wedding basic.",
      href: "/vendor/offerings/packages/new",
      cta: "Create a package",
    },
    addons: {
      title: "No add-ons yet",
      body: "Extras customers can add to an offering, like drone coverage or an extra hour.",
      href: "/vendor/offerings/new?kind=addon",
      cta: "Add an add-on",
    },
  };

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Offerings &amp; packages</h1>
          <p className="text-ink-soft text-lead mt-1">
            {offerings.length} of {limit} used ·{" "}
            <Link href={`/vendors/${vendorId}?preview=1`} className="text-accent hover:underline underline-offset-2">
              see them on your profile
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/vendor/offerings/packages/new" className="btn btn-secondary">
            New package
          </Link>
          <Link href="/vendor/offerings/new" className="btn btn-primary">
            Add offering
          </Link>
        </div>
      </header>

      <div role="tablist" aria-label="Offering types" className="flex gap-1 border-b border-line mb-4 overflow-x-auto">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`min-h-11 px-4 -mb-px border-b-2 text-sm whitespace-nowrap ${
              tab === t.id ? "border-accent text-accent-hover font-medium" : "border-transparent text-ink-soft hover:text-foreground"
            }`}
          >
            {t.label} <span className="text-ink-soft">({byKind[t.id].length})</span>
          </button>
        ))}
      </div>

      <p aria-live="polite" className="sr-only">
        {notice?.tone === "ok" ? notice.text : ""}
      </p>
      {notice && (
        <p className={`${notice.tone === "ok" ? "alert-success" : "alert-error"} mb-4`} role={notice.tone === "error" ? "alert" : undefined}>
          {notice.text}
        </p>
      )}

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0} className="focus-visible:outline-offset-4">
        {tab === "packages" && byKind.packages.some((p) => p.incomplete) && (
          <p className="mb-4 rounded-control bg-[#fdf3d8] text-gold-ink px-3 py-2 text-sm">
            Packages marked Incomplete include a unit that is off. They are hidden from customers until you turn the
            unit back on or edit the package.
          </p>
        )}
        {list.length === 0 ? (
          <div className="card text-center py-10">
            <h2 className="text-title font-semibold">{empty[tab].title}</h2>
            <p className="text-body text-ink-soft mt-1 max-w-sm mx-auto">{empty[tab].body}</p>
            <Link href={empty[tab].href} className="btn btn-primary mt-4">
              {empty[tab].cta}
            </Link>
          </div>
        ) : tab === "units" ? (
          <div className="flex flex-col gap-6">
            {groups.map(([cat, os]) => (
              <section key={cat} aria-label={cat}>
                <h2 className="eyebrow mb-2">{cat}</h2>
                <ul className="card !p-0 divide-y divide-line overflow-hidden">{os.map((o, i) => row(o, i, os))}</ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className="card !p-0 divide-y divide-line overflow-hidden">{list.map((o, i) => row(o, i, list))}</ul>
        )}
      </div>
          </>
  );
}
