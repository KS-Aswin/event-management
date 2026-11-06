import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/app/api/_lib/auth";
import { getOwnVendor } from "@/lib/db";
import { INSIGHT_RANGES, getVendorInsights, parseRange, type InsightCounts } from "@/lib/insights";

export const metadata: Metadata = { title: "Insights" };

// Vendor insights (PRODUCT_PLAN P2-14): views, WhatsApp clicks, enquiries
// and booked rate for the last 7 / 30 / 90 days against the period before.

const STATUS_LABEL: Record<string, string> = {
  pending: "New (not answered)",
  responded: "Replied",
  accepted: "Offer accepted",
  booked: "Booked",
  declined: "Not a fit",
  withdrawn: "Withdrawn by customer",
  expired: "Expired",
};
const STATUS_ORDER = ["pending", "responded", "accepted", "booked", "declined", "withdrawn", "expired"];

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

function Delta({ cur, prev, kind = "count", range }: { cur: number | null; prev: number | null; kind?: "count" | "rate"; range: number }) {
  if (cur === null || prev === null) return <p className="text-caption text-ink-soft mt-1">No enquiries to compare yet</p>;
  const diff = kind === "rate" ? Math.round((cur - prev) * 100) : cur - prev;
  const unit = kind === "rate" ? " pts" : "";
  const text = diff === 0 ? "Same as" : `${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString("en-IN")}${unit} vs`;
  return (
    <p className={`text-caption mt-1 ${diff > 0 ? "text-accent-hover" : "text-ink-soft"}`}>
      {text} the {range} days before
    </p>
  );
}

function Tile({ label, value, children, testId }: { label: string; value: string; children?: React.ReactNode; testId: string }) {
  return (
    <div className="card p-4 sm:p-5" data-testid={testId}>
      <p className="text-caption text-ink-soft font-medium">{label}</p>
      <p className="font-display text-[28px] leading-tight font-semibold tabular-nums mt-1" data-value>
        {value}
      </p>
      {children}
    </div>
  );
}

export default async function VendorInsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session } = await requirePageRole("vendor");
  const vendor = await getOwnVendor(session.userId);
  const sp = await searchParams;
  const range = parseRange(typeof sp.range === "string" ? sp.range : null) ?? 30;

  if (!vendor) {
    return (
      <main className="page py-6 sm:py-8">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight mb-6">Insights</h1>
        <div className="card max-w-xl">
          <h2 className="text-title font-semibold">No listing yet</h2>
          <p className="text-body text-ink-soft mt-1">Create your listing to start seeing views and enquiries.</p>
          <Link href="/vendor/onboarding" className="btn btn-primary mt-4">
            Continue setup
          </Link>
        </div>
      </main>
    );
  }

  const ins = await getVendorInsights(vendor.id, range);
  const c: InsightCounts = ins.current;
  const p: InsightCounts = ins.previous;
  const empty = c.views + c.whatsappClicks + c.phoneReveals + c.enquiries === 0;
  const live = vendor.status === "approved";

  return (
    <main className="page py-6 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Insights</h1>
          <p className="text-ink-soft text-lead mt-1">How customers found and contacted you.</p>
        </div>
        <nav aria-label="Time range" className="inline-flex rounded-control border border-line-strong p-0.5 bg-surface">
          {INSIGHT_RANGES.map((r) => (
            <Link
              key={r}
              href={`?range=${r}`}
              aria-current={r === range ? "page" : undefined}
              scroll={false}
              className={`inline-flex items-center justify-center min-h-11 sm:min-h-9 px-3.5 rounded-[6px] text-sm transition-colors ${
                r === range ? "bg-accent text-white font-medium" : "text-foreground hover:bg-surface-muted"
              }`}
            >
              {r} days
            </Link>
          ))}
        </nav>
      </header>

      {empty && (
        <div className="card mb-5" role="status">
          <h2 className="text-title font-semibold">{`Nothing in the last ${range} days yet`}</h2>
          <p className="text-body text-ink-soft mt-1 max-w-[62ch]">
            {live
              ? "Views, WhatsApp clicks and enquiries show up here as customers find you. Profiles with 6+ photos, clear prices and a filled-in calendar get more enquiries."
              : "Your listing isn't live yet. Once Vela approves it, views and enquiries will show up here."}
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href="/vendor/media" className="btn btn-secondary">
              Add photos
            </Link>
            <Link href="/vendor/offerings" className="btn btn-secondary">
              Check your prices
            </Link>
          </div>
        </div>
      )}

      <section aria-label={`Last ${range} days`} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Profile views" value={c.views.toLocaleString("en-IN")} testId="insight-views">
          <Delta cur={c.views} prev={p.views} range={range} />
        </Tile>
        <Tile label="WhatsApp clicks" value={c.whatsappClicks.toLocaleString("en-IN")} testId="insight-whatsapp">
          <Delta cur={c.whatsappClicks} prev={p.whatsappClicks} range={range} />
        </Tile>
        <Tile label="Enquiries" value={c.enquiries.toLocaleString("en-IN")} testId="insight-enquiries">
          <Delta cur={c.enquiries} prev={p.enquiries} range={range} />
        </Tile>
        <Tile label="Booked rate" value={pct(c.bookedRate)} testId="insight-booked-rate">
          <p className="text-caption text-ink-soft mt-1">
            {c.booked} of {c.enquiries} enquir{c.enquiries === 1 ? "y" : "ies"} booked
          </p>
        </Tile>
      </section>

      <div className="grid gap-5 lg:grid-cols-2 mt-5">
        <section className="card" aria-labelledby="funnel-h">
          <h2 id="funnel-h" className="text-title font-semibold mb-2">
            From view to booking
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-body">
            {[
              ["Views that became an enquiry", pct(c.views > 0 ? c.enquiries / c.views : null)],
              ["Enquiries you replied to", pct(c.enquiries > 0 ? c.replied / c.enquiries : null)],
              ["Enquiries booked", pct(c.bookedRate)],
              ["Phone number reveals", c.phoneReveals.toLocaleString("en-IN")],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-soft py-2 border-b border-line">{k}</dt>
                <dd className="py-2 border-b border-line text-right tabular-nums font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="hint">Each browser counts once per visit, and your own visits aren&apos;t counted.</p>
        </section>

        <section className="card" aria-labelledby="status-h">
          <h2 id="status-h" className="text-title font-semibold mb-2">
            Enquiries from the last {range} days, by status
          </h2>
          {c.enquiries === 0 ? (
            <p className="text-body text-ink-soft">No enquiries in this period.</p>
          ) : (
            <ul>
              {STATUS_ORDER.filter((s) => ins.byStatus[s]).map((s) => (
                <li key={s} className="flex justify-between gap-3 py-2 border-b border-line last:border-b-0 text-body">
                  <span>{STATUS_LABEL[s] ?? s}</span>
                  <span className="tabular-nums font-medium">{ins.byStatus[s]}</span>
                </li>
              ))}
            </ul>
          )}
          {(ins.byStatus.pending ?? 0) > 0 && (
            <Link href="/vendor/leads?status=pending" className="btn btn-secondary mt-3">
              Answer new enquiries
            </Link>
          )}
        </section>
      </div>
    </main>
  );
}
