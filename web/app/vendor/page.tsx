import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findListingMissing, findVendorHomeStats, getOwnVendor, type VendorHomeStats } from "@/lib/db";
import StatusChip from "@/app/_nav/status-chip";
import { profileStrength, type StrengthItem } from "./profile-strength";
import { StatusPill } from "./leads/lead-row";
import { daysFromToday, formatReceived, formatShortDate, relativeDays } from "./leads/format";

export const metadata: Metadata = { title: "Home" };

// Vendor workspace home (PRODUCT_PLAN 7 Vendor/Home, P0-12): listing status
// with the next step, profile strength, new leads, upcoming bookings, 7-day
// numbers and quick actions. Vendor business data only: no customer
// favourites or "my requests" are loaded here.

const MISSING_LABEL: Record<string, string> = {
  basics: "business basics (name, category, district, phone, a short about)",
  offering: "one offering or package with a price",
  logo_or_cover: "a logo or cover photo",
  images: "at least 3 photos",
};

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default async function VendorHomePage() {
  const { session } = await requirePageRole("vendor");
  const vendor = await getOwnVendor(session.userId);
  if (!vendor) redirect("/vendor/onboarding");
  const [stats, missing] = await Promise.all([findVendorHomeStats(vendor.id), findListingMissing(vendor.id)]);
  if (!stats) redirect("/vendor/onboarding");

  const strength = profileStrength(stats, vendor.about ?? "");
  const firstName = session.name.split(" ")[0];
  const previewHref = `/vendors/${vendor.id}?preview=1`;

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink-soft text-body">
            {greeting()}, {firstName}
          </p>
          <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 break-words">{vendor.name}</span>
            {/* On phones the workspace bar above already shows the status. */}
            <span className="hidden lg:inline">
              <StatusChip status={vendor.status} />
            </span>
          </h1>
        </div>
        <Link href={previewHref} className="btn btn-secondary btn-sm">
          Preview public profile
        </Link>
      </header>

      <StatusBanner stats={stats} missing={missing} vendorId={vendor.id} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start mt-4">
        <div className="flex flex-col gap-4 min-w-0">
          <NextSteps stats={stats} items={strength.items} />
          <NewLeads stats={stats} />
          <Upcoming stats={stats} />
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <Strength percent={strength.percent} done={strength.done} total={strength.total} items={strength.items} />
          <WeekStats stats={stats} />
          <QuickActions previewHref={previewHref} />
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

type Tone = "info" | "warn" | "good" | "bad";
const TONE_CLASS: Record<Tone, string> = {
  info: "border-line bg-surface-muted",
  warn: "border-[#ecd98f] bg-[#fdf8e7]",
  good: "border-accent/30 bg-accent-tint",
  bad: "border-danger/30 bg-danger-tint",
};

function StatusBanner({ stats, missing, vendorId }: { stats: VendorHomeStats; missing: string[]; vendorId: number }) {
  const step = Math.min(Math.max(stats.onboardingStep || 1, 1), 6);
  const reason = stats.statusReason?.trim();
  let tone: Tone = "info";
  let title = "";
  let body: React.ReactNode = null;
  let cta: { href: string; label: string } | null = null;
  let secondary: { href: string; label: string } | null = null;

  switch (stats.status) {
    case "draft":
      tone = "warn";
      if (missing.length === 0) {
        title = "Your listing is ready to submit";
        body = "Submit it for review. Once approved, customers can find you in search and send enquiries.";
        cta = { href: "/vendor/onboarding?step=6", label: "Review and submit" };
      } else {
        title = `Finish setting up: step ${step} of 6`;
        body = (
          <>
            Customers can&apos;t see your listing yet. Still needed: {missing.map((m) => MISSING_LABEL[m] ?? m).join("; ")}.
          </>
        );
        cta = { href: `/vendor/onboarding?step=${step}`, label: `Continue step ${step}` };
      }
      break;
    case "pending":
      tone = "info";
      title = "Under review";
      body = "We usually review new listings within 24 hours. You can keep editing while you wait; we'll let you know when you're live.";
      cta = { href: `/vendors/${vendorId}?preview=1`, label: "Preview your profile" };
      break;
    case "changes_requested":
      tone = "warn";
      title = "Changes requested";
      body = (
        <>
          {reason ? (
            <>
              Our team asked for a few changes before your listing goes live:
              <span className="block mt-2 pl-3 border-l-2 border-gold-ink/50 whitespace-pre-line">{reason}</span>
            </>
          ) : (
            "Our team asked for a few changes before your listing goes live."
          )}
        </>
      );
      cta = { href: "/vendor/onboarding?step=6", label: "Fix and resubmit" };
      secondary = { href: "/vendor/profile", label: "Edit profile" };
      break;
    case "approved":
      tone = "good";
      title = "Your listing is live";
      body = stats.rereviewRequired
        ? "Customers can find you in search. Your recent change to your name, category or phone is being checked by our team; you stay live meanwhile."
        : "Customers can find you in search and send you enquiries. Keep your photos and prices fresh to get more leads.";
      cta = { href: `/vendors/${vendorId}`, label: "View public profile" };
      break;
    case "rejected":
      tone = "bad";
      title = "Your listing wasn't approved";
      body = (
        <>
          {reason ? <span className="block whitespace-pre-line">Reason: {reason}</span> : null}
          <span className="block mt-1">You can fix the details and submit again, or contact us if you think this is a mistake.</span>
        </>
      );
      cta = { href: "/vendor/onboarding?step=6", label: "Edit and resubmit" };
      secondary = { href: "/help", label: "Contact support" };
      break;
    case "suspended":
      tone = "bad";
      title = "Your listing is suspended";
      body = (
        <>
          {reason ? <span className="block whitespace-pre-line">Reason: {reason}</span> : null}
          <span className="block mt-1">Customers can&apos;t see your profile right now. Contact us to resolve this.</span>
        </>
      );
      cta = { href: "/help", label: "Contact support" };
      break;
  }

  return (
    <section
      aria-labelledby="status-title"
      data-status={stats.status}
      className={`rounded-card border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 ${TONE_CLASS[tone]}`}
    >
      <div className="min-w-0 flex-1">
        <h2 id="status-title" className="text-title font-semibold">
          {title}
        </h2>
        <div className="text-body mt-1 text-foreground/85">{body}</div>
      </div>
      {(cta || secondary) && (
        <div className="flex flex-wrap gap-2 shrink-0">
          {cta && (
            <Link href={cta.href} className="btn btn-primary">
              {cta.label}
            </Link>
          )}
          {secondary && (
            <Link href={secondary.href} className="btn btn-secondary">
              {secondary.label}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function NextSteps({ stats, items }: { stats: VendorHomeStats; items: StrengthItem[] }) {
  const steps: { label: string; detail?: string; href: string; key: string }[] = [];
  if (stats.leads.new > 0) {
    steps.push({
      key: "new",
      label: `Reply to ${stats.leads.new} new ${stats.leads.new === 1 ? "lead" : "leads"}`,
      detail: "Customers usually book whoever answers first.",
      href: "/vendor/leads?status=pending",
    });
  }
  if (stats.leads.followUpsDue > 0) {
    steps.push({
      key: "follow",
      label: `${stats.leads.followUpsDue} follow-up${stats.leads.followUpsDue === 1 ? "" : "s"} due`,
      detail: "Leads you planned to get back to today or earlier.",
      href: "/vendor/leads",
    });
  }
  if (stats.offerings.incompletePackages > 0) {
    steps.push({
      key: "pkg",
      label: `Fix ${stats.offerings.incompletePackages} incomplete package${stats.offerings.incompletePackages === 1 ? "" : "s"}`,
      detail: "A unit inside it was turned off, so customers can't see it.",
      href: "/vendor/offerings",
    });
  }
  for (const i of items) {
    if (steps.length >= 4) break;
    if (!i.done) steps.push({ key: i.key, label: i.label, href: i.href });
  }
  if (steps.length === 0) return null;

  return (
    <section className="card" aria-labelledby="next-h">
      <h2 id="next-h" className="text-title font-semibold">
        What to do next
      </h2>
      <ol className="mt-2">
        {steps.map((s, i) => (
          <li key={s.key} className="border-b border-line last:border-b-0">
            <Link href={s.href} className="flex items-center gap-3 min-h-14 py-2.5 group">
              <span
                aria-hidden="true"
                className="inline-grid place-items-center size-7 rounded-full bg-accent-tint text-accent text-caption font-semibold shrink-0"
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium group-hover:text-accent">{s.label}</span>
                {s.detail && <span className="block text-caption text-ink-soft">{s.detail}</span>}
              </span>
              <span aria-hidden="true" className="text-ink-soft group-hover:text-accent">
                →
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NewLeads({ stats }: { stats: VendorHomeStats }) {
  const leads = stats.recentLeads;
  return (
    <section className="card" aria-labelledby="leads-h">
      <div className="flex items-center justify-between gap-2 -mt-1">
        <h2 id="leads-h" className="text-title font-semibold">
          Latest leads
          {stats.leads.new > 0 && (
            <span className="ml-2 align-middle chip bg-[#fbf3d9] text-gold-ink">{stats.leads.new} new</span>
          )}
        </h2>
        {stats.leads.total > 0 && (
          <Link href="/vendor/leads" className="btn btn-ghost btn-sm -mr-3">
            All {stats.leads.total}
          </Link>
        )}
      </div>
      {leads.length === 0 ? (
        <p className="text-body text-ink-soft mt-1">
          {stats.status === "approved"
            ? "No enquiries yet. Leads show up here with the event details and what the customer asked for."
            : "Once your listing is live, customer enquiries show up here."}
        </p>
      ) : (
        <ul className="mt-1">
          {leads.map((l) => (
            <li key={l.id} className="border-b border-line last:border-b-0">
              <Link href={`/vendor/leads/${l.id}`} className="flex items-start justify-between gap-3 py-3 min-h-11 group">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-body group-hover:text-accent">{l.name}</span>
                    <StatusPill status={l.status} audience="vendor" />
                  </span>
                  <span className="block text-caption text-ink-soft mt-0.5">
                    {l.event_date ? `Event ${formatShortDate(l.event_date)}` : "No date yet"}
                    {l.units.length ? ` · ${l.units.slice(0, 3).join(", ")}${l.units.length > 3 ? ` +${l.units.length - 3}` : ""}` : ""}
                  </span>
                </span>
                <span className="text-caption text-ink-soft whitespace-nowrap">{formatReceived(l.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Upcoming({ stats }: { stats: VendorHomeStats }) {
  return (
    <section className="card" aria-labelledby="upcoming-h">
      <h2 id="upcoming-h" className="text-title font-semibold">
        Upcoming bookings
      </h2>
      {stats.upcoming.length === 0 ? (
        <p className="text-body text-ink-soft mt-1">
          No booked dates coming up. When you mark a lead as Booked, its date shows here.
        </p>
      ) : (
        <ul className="mt-1">
          {stats.upcoming.map((b) => {
            const diff = daysFromToday(b.event_date);
            return (
              <li key={b.id} className="border-b border-line last:border-b-0">
                <Link href={`/vendor/leads/${b.id}`} className="flex items-center gap-3 py-2.5 min-h-11 group">
                  <span className="inline-flex flex-col items-center justify-center w-12 h-12 rounded-control bg-accent-tint text-accent-hover shrink-0 leading-none">
                    <span className="text-[11px] font-medium uppercase">{formatShortDate(b.event_date).split(" ").slice(-1)[0]}</span>
                    <span className="text-title font-semibold">{formatShortDate(b.event_date).split(" ").slice(-2, -1)[0]}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium group-hover:text-accent">
                      {b.event_type_name ?? "Event"} for {b.name}
                    </span>
                    <span className="block text-caption text-ink-soft">
                      {formatShortDate(b.event_date)}
                      {diff !== null ? ` (${relativeDays(diff)})` : ""}
                      {b.guest_count ? ` · ${b.guest_count.toLocaleString("en-IN")} guests` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Strength({ percent, done, total, items }: { percent: number; done: number; total: number; items: StrengthItem[] }) {
  const complete = done === total;
  return (
    <section className="card" aria-labelledby="strength-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="strength-h" className="text-title font-semibold">
          Profile strength
        </h2>
        <span className="text-title font-semibold text-accent tabular-nums" data-testid="strength-percent">
          {percent}%
        </span>
      </div>
      <p className="text-caption text-ink-soft mt-0.5 mb-3">
        {complete ? "Everything is in place. Nice work." : `${done} of ${total} done. Complete profiles get more enquiries.`}
      </p>
      <div
        className="h-2 rounded-full bg-line overflow-hidden"
        role="progressbar"
        aria-label="Profile strength"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <details className="mt-3 group" open={!complete}>
        <summary className="flex items-center justify-between min-h-11 cursor-pointer text-sm font-medium text-accent list-none [&::-webkit-details-marker]:hidden">
          {complete ? "Show checklist" : "Checklist"}
          <span aria-hidden="true" className="text-ink-soft transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <ul className="text-sm">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 min-h-11 border-b border-line last:border-b-0">
              <span
                aria-hidden="true"
                className={`inline-flex items-center justify-center size-5 rounded-full shrink-0 border ${
                  item.done ? "bg-accent border-accent text-white" : "border-line-strong bg-surface"
                }`}
              >
                {item.done ? (
                  <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3.5 8.5l3 3 6-6.5" />
                  </svg>
                ) : null}
              </span>
              {item.done ? (
                <span className="text-ink-soft py-2">
                  {item.label}
                  <span className="sr-only"> (done)</span>
                </span>
              ) : (
                <Link href={item.href} className="flex-1 flex items-center justify-between gap-2 min-h-11 py-2 font-medium hover:text-accent">
                  {item.label}
                  <span aria-hidden="true" className="text-ink-soft">
                    →
                  </span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function WeekStats({ stats }: { stats: VendorHomeStats }) {
  const tiles: { label: string; value: number | string }[] = [
    { label: "Profile views", value: stats.last7Days.profileViews },
    { label: "WhatsApp taps", value: stats.last7Days.whatsappClicks },
    { label: "Enquiries", value: stats.leads.last7Days },
    { label: "Rating", value: stats.rating.count > 0 ? `${stats.rating.average.toFixed(1)} ★` : "–" },
  ];
  return (
    <section className="card" aria-labelledby="week-h">
      <h2 id="week-h" className="text-title font-semibold">
        Last 7 days
      </h2>
      <dl className="grid grid-cols-2 gap-px mt-3 rounded-control overflow-hidden bg-line border border-line">
        {tiles.map((t) => (
          <div key={t.label} className="bg-surface p-3">
            <dt className="text-caption text-ink-soft">{t.label}</dt>
            <dd className="text-heading font-semibold tabular-nums mt-0.5">{t.value}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">
        {stats.rating.count > 0
          ? `Rating from ${stats.rating.count} review${stats.rating.count === 1 ? "" : "s"}. `
          : ""}
        {stats.leads.booked > 0 ? `${stats.leads.booked} booked in total.` : ""}
      </p>
    </section>
  );
}

function QuickActions({ previewHref }: { previewHref: string }) {
  const actions = [
    { href: "/vendor/offerings/new", label: "Add an offering" },
    { href: "/vendor/media", label: "Upload photos or videos" },
    { href: "/vendor/profile", label: "Edit business profile" },
    { href: "/vendor/areas", label: "Districts you serve" },
    { href: previewHref, label: "Preview public profile" },
  ];
  return (
    <nav className="card" aria-labelledby="quick-h">
      <h2 id="quick-h" className="text-title font-semibold">
        Quick actions
      </h2>
      <ul className="mt-1">
        {actions.map((a) => (
          <li key={a.href} className="border-b border-line last:border-b-0">
            <Link href={a.href} className="flex items-center justify-between gap-2 min-h-11 py-2 text-body font-medium hover:text-accent">
              {a.label}
              <span aria-hidden="true" className="text-ink-soft">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
