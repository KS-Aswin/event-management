import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage } from "@/app/admin/_components/admin-page";
import { getAnalytics, parseRange, RANGES, SUPPLY_GAP_DAYS, type AnalyticsSummary } from "@/lib/admin/analytics";
import { plural } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Analytics" };

// P1-12: signups, listings, enquiries, response times and supply gaps.
// Plain server-rendered tables with CSS bars, so it works without JS, at
// 390 px and with zero rows. Definitions are listed at the bottom.

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending: "Pending review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};

const nf = new Intl.NumberFormat("en-IN");

function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function fmtMinutes(m: number | null): string {
  if (m == null) return "No responses yet";
  if (m < 1) return "Under a minute";
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  const d = Math.floor(m / (60 * 24));
  const h = Math.round((m % (60 * 24)) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/**
 * The parts under the Signups headline. They always add up to the headline:
 * admin accounts are listed too when any were created in the range (QA-022).
 */
function signupBreakdown(t: AnalyticsSummary["signups"]["totals"]): string {
  const parts = [plural(t.vendor, "vendor"), plural(t.customer, "customer")];
  if (t.admin > 0) parts.push(plural(t.admin, "admin"));
  return parts.join(" · ");
}

function pct(n: number | null) {
  return n == null ? "No enquiries" : `${Math.round(n * 100)}%`;
}

/** Decorative bar; the number next to it is the accessible value. */
function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "gold" | "danger" }) {
  const width = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0;
  const color = tone === "gold" ? "bg-gold" : tone === "danger" ? "bg-danger" : "bg-accent";
  return (
    <span aria-hidden="true" className="block h-2 w-full min-w-[3rem] overflow-hidden rounded-full bg-surface-muted">
      <span className={`block h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
    </span>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="card p-4 sm:p-5 min-w-0">
      <h2 id={id} className="text-title font-semibold">
        {title}
      </h2>
      {note ? <p className="text-caption text-ink-soft mt-0.5">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-control bg-surface-muted px-3 py-4 text-body text-ink-soft">{children}</p>;
}

const th = "px-3 py-2 font-medium text-left whitespace-nowrap";
const td = "px-3 py-2 align-middle";
const num = "px-3 py-2 align-middle text-right tabular-nums whitespace-nowrap";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4 min-w-0">
      <dt className="text-caption text-ink-soft">{label}</dt>
      <dd className="mt-1 text-heading font-semibold tabular-nums">{value}</dd>
      {sub ? <dd className="text-caption text-ink-soft mt-0.5">{sub}</dd> : null}
    </div>
  );
}

function RangePicker({ days }: { days: number }) {
  return (
    <nav aria-label="Date range">
      <ul className="inline-flex rounded-control border border-line-strong bg-surface p-0.5">
        {RANGES.map((r) => {
          const active = r === days;
          return (
            <li key={r}>
              <Link
                href={`/admin/analytics?days=${r}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 sm:min-h-10 items-center rounded-[6px] px-3.5 text-sm font-medium transition-colors ${
                  active ? "bg-accent text-white" : "text-ink-soft hover:bg-surface-muted hover:text-accent"
                }`}
              >
                {r} days
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SignupsTable({ data }: { data: AnalyticsSummary["signups"] }) {
  if (data.totals.all === 0) return <Empty>No one signed up in this period.</Empty>;
  const rows = [...data.byDay].reverse(); // newest first
  const max = Math.max(...rows.map((r) => r.customer + r.vendor + r.admin));
  return (
    <div
      className="max-h-[28rem] overflow-auto rounded-control border border-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      // Scrollable, so keyboard users must be able to reach it (QA-083, axe scrollable-region-focusable).
      tabIndex={0}
      role="region"
      aria-label="Signups per day (scrollable)"
    >
      <table className="w-full text-sm">
        <caption className="sr-only">Signups per day by role, newest first</caption>
        <thead className="sticky top-0 bg-surface-muted">
          <tr>
            <th scope="col" className={th}>Day</th>
            <th scope="col" className={`${th} text-right`}>Customers</th>
            <th scope="col" className={`${th} text-right`}>Vendors</th>
            <th scope="col" className={`${th} text-right hidden sm:table-cell`}>Admins</th>
            <th scope="col" className={`${th} w-1/3 hidden min-[480px]:table-cell`}><span className="sr-only">Total bar</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = r.customer + r.vendor + r.admin;
            return (
              <tr key={r.day} className="border-t border-line">
                <th scope="row" className={`${td} font-normal text-left whitespace-nowrap`}>{fmtDay(r.day)}</th>
                <td className={num}>{r.customer}</td>
                <td className={num}>{r.vendor}</td>
                <td className={`${num} hidden sm:table-cell`}>{r.admin}</td>
                <td className={`${td} hidden min-[480px]:table-cell`}>
                  <Bar value={total} max={max} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-strong bg-surface-muted font-medium">
            <th scope="row" className={`${td} text-left`}>Total</th>
            <td className={num}>{data.totals.customer}</td>
            <td className={num}>{data.totals.vendor}</td>
            <td className={`${num} hidden sm:table-cell`}>{data.totals.admin}</td>
            <td className={`${td} hidden min-[480px]:table-cell`} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ListingsTable({ rows, total }: { rows: AnalyticsSummary["listings"]; total: number }) {
  if (total === 0) return <Empty>No vendor listings yet.</Empty>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Vendor listings by status</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Listings</th>
          <th scope="col">Bar</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.status} className="border-t border-line first:border-t-0">
            <th scope="row" className={`${td} pl-0 font-normal text-left whitespace-nowrap`}>
              {STATUS_LABEL[r.status] ?? r.status}
            </th>
            <td className={num}>{nf.format(r.count)}</td>
            <td className={`${td} w-2/5 pr-0`}>
              <Bar value={r.count} max={max} tone={r.status === "approved" ? "accent" : r.status === "pending" || r.status === "changes_requested" ? "gold" : "danger"} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EnquiriesTable({ data }: { data: AnalyticsSummary["enquiries"] }) {
  if (data.total === 0) return <Empty>No enquiries in this period.</Empty>;
  const max = Math.max(...data.rows.map((r) => r.enquiries));
  return (
    <>
      <div
        className="overflow-x-auto rounded-control border border-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        tabIndex={0}
        role="region"
        aria-label="Enquiries by district, category and event type"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Enquiries by district, category and event type, most first</caption>
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className={th}>District</th>
              <th scope="col" className={`${th} hidden sm:table-cell`}>Category</th>
              <th scope="col" className={`${th} hidden sm:table-cell`}>Event type</th>
              <th scope="col" className={`${th} text-right`}>Enquiries</th>
              <th scope="col" className={`${th} w-1/4 hidden md:table-cell`}><span className="sr-only">Bar</span></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={`${r.district}|${r.category}|${r.eventType}`} className="border-t border-line">
                <td className={td}>
                  {r.district}
                  <span className="block text-caption text-ink-soft sm:hidden">
                    {r.category} · {r.eventType}
                  </span>
                </td>
                <td className={`${td} hidden sm:table-cell`}>{r.category}</td>
                <td className={`${td} hidden sm:table-cell`}>{r.eventType}</td>
                <td className={num}>{nf.format(r.enquiries)}</td>
                <td className={`${td} hidden md:table-cell`}>
                  <Bar value={r.enquiries} max={max} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.more > 0 ? (
        <p className="text-caption text-ink-soft mt-2">
          Showing the top {data.rows.length} combinations. {data.more} smaller {data.more === 1 ? "one is" : "ones are"} not shown.
        </p>
      ) : null}
    </>
  );
}

function SupplyGapTable({ rows }: { rows: AnalyticsSummary["supplyGap"] }) {
  if (!rows.length) return <Empty>No enquiries with a district and category in the last {SUPPLY_GAP_DAYS} days.</Empty>;
  const max = Math.max(...rows.map((r) => (r.ratio == null ? r.enquiries : r.ratio)));
  return (
    <div
      className="overflow-x-auto rounded-control border border-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      tabIndex={0}
      role="region"
      aria-label="Supply gap by district and category"
    >
      <table className="w-full text-sm">
        <caption className="sr-only">Supply gap: enquiries per approved vendor by district and category, biggest gap first</caption>
        <thead className="bg-surface-muted">
          <tr>
            <th scope="col" className={th}>District</th>
            <th scope="col" className={`${th} hidden sm:table-cell`}>Category</th>
            <th scope="col" className={`${th} text-right`}>Enquiries</th>
            <th scope="col" className={`${th} text-right`}>
              <span className="sm:hidden">Vendors</span>
              <span className="hidden sm:inline">Approved vendors</span>
            </th>
            <th scope="col" className={`${th} text-right`}>Per vendor</th>
            <th scope="col" className={`${th} w-1/5 hidden md:table-cell`}><span className="sr-only">Bar</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.district}|${r.category}`} className="border-t border-line">
              <td className={td}>
                {r.district}
                <span className="block text-caption text-ink-soft sm:hidden">{r.category}</span>
              </td>
              <td className={`${td} hidden sm:table-cell`}>{r.category}</td>
              <td className={num}>{nf.format(r.enquiries)}</td>
              <td className={num}>{nf.format(r.approvedVendors)}</td>
              <td className={num}>
                {r.ratio == null ? <span className="font-medium text-danger">No vendors</span> : r.ratio.toFixed(1)}
              </td>
              <td className={`${td} hidden md:table-cell`}>
                <Bar value={r.ratio ?? max} max={max} tone={r.ratio == null ? "danger" : r.ratio >= 5 ? "gold" : "accent"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const days = parseRange((await searchParams).days);
  let data: AnalyticsSummary | null = null;
  try {
    data = await getAnalytics(days);
  } catch (err) {
    console.error("admin analytics failed", err);
  }

  return (
    <AdminPage
      title="Analytics"
      description="Signups, listings, enquiries, how fast vendors respond, and where demand outruns supply."
      actions={<RangePicker days={days} />}
    >
      {!data ? (
        <div role="alert" className="alert-error max-w-xl">
          Analytics could not be loaded right now. <Link href={`/admin/analytics?days=${days}`} className="underline">Try again</Link>.
        </div>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label={`Signups, last ${days} days`} value={nf.format(data.signups.totals.all)} sub={signupBreakdown(data.signups.totals)} />
            <Stat label={`Enquiries, last ${days} days`} value={nf.format(data.response.total)} />
            <Stat label="Response rate" value={pct(data.response.rate)} sub={data.response.total ? `${data.response.responded} of ${data.response.total} answered` : undefined} />
            <Stat label="Median first response" value={fmtMinutes(data.response.medianMinutes)} />
          </dl>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Section id="an-signups" title="Signups by role" note={`Per day, last ${days} days, India time. Newest first.`}>
              <SignupsTable data={data.signups} />
            </Section>
            <div className="space-y-5 min-w-0">
              <Section id="an-listings" title="Listings by status" note={`All ${nf.format(data.listingsTotal)} vendor listings right now.`}>
                <ListingsTable rows={data.listings} total={data.listingsTotal} />
              </Section>
              <Section id="an-engagement" title="Profile activity" note={`Last ${days} days. Owner and admin visits are not counted.`}>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Profile views", data.engagement.profileViews],
                    ["WhatsApp taps", data.engagement.whatsappClicks],
                    ["Phone taps", data.engagement.phoneReveals],
                  ].map(([label, n]) => (
                    <div key={label as string} className="rounded-control bg-surface-muted px-2 py-3">
                      <dt className="text-caption text-ink-soft">{label}</dt>
                      <dd className="text-title font-semibold tabular-nums">{nf.format(n as number)}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            </div>
          </div>

          <Section id="an-enquiries" title="Enquiries by district, category and event type" note={`Last ${days} days, most first.`}>
            <EnquiriesTable data={data.enquiries} />
          </Section>

          <Section
            id="an-gap"
            title="Supply gap"
            note={`Enquiries per approved vendor, last ${SUPPLY_GAP_DAYS} days (fixed, whatever the range above). Biggest gap first.`}
          >
            <SupplyGapTable rows={data.supplyGap} />
          </Section>

          <section aria-labelledby="an-defs" className="rounded-card border border-line bg-surface-muted p-4 sm:p-5 text-sm text-ink-soft">
            <h2 id="an-defs" className="text-body font-semibold text-foreground">
              How these numbers are worked out
            </h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 max-w-prose">
              <li>Days are calendar days in India time. The range counts back from now.</li>
              <li>
                <strong className="font-medium">First vendor response</strong> is the earliest of: the vendor&apos;s first
                message, their first quote offer, or the first status change away from &ldquo;pending&rdquo; (withdrawn and
                expired do not count).
              </li>
              <li>
                <strong className="font-medium">Response rate</strong> is enquiries with a first response divided by all
                enquiries received in the range, including withdrawn ones. Very recent enquiries pull it down until vendors reply.
              </li>
              <li>
                <strong className="font-medium">Median first response</strong> is the middle time from enquiry to first
                response, over the enquiries that got one.
              </li>
              <li>
                An enquiry&apos;s district is the one the customer gave, otherwise the vendor&apos;s. Its category is the
                vendor&apos;s main category.
              </li>
              <li>
                <strong className="font-medium">Supply gap</strong> divides enquiries by approved, published vendors whose own
                district and main category match. &ldquo;No vendors&rdquo; means demand with no local supply at all.
              </li>
              <li>Profile views count once per browser session per vendor. WhatsApp and phone taps are counted per tap.</li>
            </ul>
            <p className="mt-3 text-caption">Updated {new Date(data.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}.</p>
          </section>
        </div>
      )}
    </AdminPage>
  );
}
