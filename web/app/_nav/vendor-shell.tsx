"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { VENDOR_NAV, isActive, type NavItem } from "./config";
import { VENDOR_ONBOARDING } from "./routes";
import NavIcon from "./nav-icon";
import StatusChip from "./status-chip";

export interface ShellVendor {
  id: number;
  name: string;
  status: string | null;
}

// Vendor workspace frame: sidebar from lg up, fixed bottom tab bar below
// it. Onboarding gets neither (the header collapses to "Save & exit").
export default function VendorShell({
  vendor,
  newLeads,
  children,
}: {
  vendor: ShellVendor | null;
  newLeads: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const onboarding = pathname === VENDOR_ONBOARDING || pathname.startsWith(VENDOR_ONBOARDING + "/");
  if (onboarding) return <div className="flex-1 flex flex-col">{children}</div>;

  const previewHref = vendor ? `/vendors/${vendor.id}?preview=1` : null;

  return (
    <div className="flex-1 flex flex-col lg:flex-row lg:gap-2 lg:w-full lg:max-w-[1180px] lg:mx-auto lg:pl-4">
      {/* Keeps the footer and page end clear of the fixed phone tab bar.
          A plain <style> unmounts with the workspace. */}
      <style>{`@media (max-width: 1023.98px) { body { padding-bottom: calc(57px + env(safe-area-inset-bottom)); } }`}</style>
      {/* Phone: business name + status above the page. */}
      <div className="lg:hidden page flex items-center justify-between gap-3 pt-3 pb-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate min-w-0">
          {vendor?.name ?? "Your business"}
        </p>
        <StatusChip status={vendor?.status ?? null} />
      </div>

      <aside className="hidden lg:block w-60 shrink-0 py-6">
        <div className="sticky top-[calc(var(--header-h)+24px)]">
          <div className="px-3 pb-4 mb-3 border-b border-line">
            <p className="eyebrow">Workspace</p>
            <p className="mt-1 text-[15px] font-semibold text-foreground truncate" title={vendor?.name}>
              {vendor?.name ?? "Your business"}
            </p>
            <StatusChip status={vendor?.status ?? null} className="mt-2" />
          </div>
          <nav aria-label="Workspace">
            <ul className="flex flex-col gap-0.5">
              {VENDOR_NAV.map((item) => (
                <li key={item.href}>
                  <SideLink item={item} pathname={pathname} badge={item.icon === "leads" ? newLeads : 0} />
                </li>
              ))}
              <li className="mt-2 pt-2 border-t border-line">
                {previewHref ? (
                  <Link
                    href={previewHref}
                    className="flex items-center gap-3 min-h-11 px-3 rounded-control text-sm text-foreground hover:bg-surface-muted hover:text-accent transition-colors"
                  >
                    <NavIcon name="preview" />
                    Preview public profile
                  </Link>
                ) : (
                  <Link
                    href={VENDOR_ONBOARDING}
                    className="flex items-center gap-3 min-h-11 px-3 rounded-control text-sm text-ink-soft hover:bg-surface-muted hover:text-accent transition-colors"
                  >
                    <NavIcon name="preview" />
                    Create your listing to preview it
                  </Link>
                )}
              </li>
            </ul>
          </nav>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">{children}</div>

      <TabBar pathname={pathname} newLeads={newLeads} previewHref={previewHref} />
    </div>
  );
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-semibold">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> new</span>
    </span>
  );
}

function SideLink({ item, pathname, badge }: { item: NavItem; pathname: string; badge: number }) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 min-h-11 px-3 rounded-control text-sm transition-colors ${
        active
          ? "bg-accent-tint text-accent-hover font-medium"
          : "text-foreground hover:bg-surface-muted hover:text-accent"
      }`}
    >
      <NavIcon name={item.icon} />
      <span className="truncate">{item.label}</span>
      <Badge count={badge} />
    </Link>
  );
}

const tabClass =
  "relative flex flex-1 flex-col items-center justify-center gap-0.5 min-h-14 min-w-0 px-1 text-[11px] leading-tight transition-colors";

function TabBar({
  pathname,
  newLeads,
  previewHref,
}: {
  pathname: string;
  newLeads: number;
  previewHref: string | null;
}) {
  const tabs = VENDOR_NAV.filter((i) => i.tab);
  const more = VENDOR_NAV.filter((i) => !i.tab);
  const moreActive = more.some((i) => isActive(pathname, i));
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close the sheet on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      const t = e.target as Node;
      if (!sheetRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const sheetLink =
    "flex items-center gap-3 min-h-12 px-4 rounded-control text-[15px] text-foreground hover:bg-surface-muted";

  return (
    <>
      {open && (
        <div
          ref={sheetRef}
          id={sheetId}
          role="dialog"
          aria-label="More workspace pages"
          className="lg:hidden fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 mx-2 mb-2 bg-white border border-line rounded-card shadow-pop p-2"
        >
          <ul>
            {more.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(pathname, item) ? "page" : undefined}
                  className={`${sheetLink} aria-[current=page]:text-accent aria-[current=page]:font-medium`}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href={previewHref ?? VENDOR_ONBOARDING} className={sheetLink}>
                <NavIcon name="preview" />
                {previewHref ? "Preview public profile" : "Create your listing"}
              </Link>
            </li>
            <li>
              <Link href="/help" className={sheetLink}>
                <NavIcon name="help" />
                Help
              </Link>
            </li>
          </ul>
        </div>
      )}
      <nav
        aria-label="Workspace"
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="flex items-stretch">
          {tabs.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href} className="flex flex-1 min-w-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`${tabClass} ${active ? "text-accent font-medium" : "text-ink-soft hover:text-foreground"}`}
                >
                  <span className="relative">
                    <NavIcon name={item.icon} size={22} />
                    {item.icon === "leads" && newLeads > 0 && (
                      <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold leading-4 text-center">
                        {newLeads > 9 ? "9+" : newLeads}
                        <span className="sr-only"> new leads</span>
                      </span>
                    )}
                  </span>
                  <span className="truncate max-w-full">{item.short ?? item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex flex-1 min-w-0">
            <button
              ref={buttonRef}
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={sheetId}
              className={`${tabClass} ${open || moreActive ? "text-accent font-medium" : "text-ink-soft hover:text-foreground"}`}
            >
              <NavIcon name="more" size={22} />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
