import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage, AdminEmptyState } from "@/app/admin/_components/admin-page";
import {
  cleanEnquiryFilters,
  getEnquiryVolume,
  listBlockedContacts,
  listEnquiries,
  listSpamSignals,
  SPAM_VENDORS,
} from "@/lib/admin/ops";
import { ago, fmtDate, fmtDateTime, Pager, qs, StatusChip } from "@/app/admin/users/_components/ui";
import { BlockButton, BlockForm, UnblockButton } from "./_components/contact-actions";

export const metadata: Metadata = { title: "Enquiries" };

const RANGES = [
  ["24h", "24 hours"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["all", "All time"],
] as const;

// P1-13 enquiry monitor: volume, spam signals (same phone to more than 10
// vendors within an hour), recent enquiries and blocked contacts.
export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const f = cleanEnquiryFilters(await searchParams);
  const [list, volume, spam, blocked] = await Promise.all([
    listEnquiries(f),
    getEnquiryVolume(),
    listSpamSignals(),
    listBlockedContacts(),
  ]);
  const filters = { q: f.q, range: f.range === "30d" ? undefined : f.range, spam: f.spam ? "1" : undefined };
  const filtered = Boolean(f.q || f.spam || f.range !== "30d");

  return (
    <AdminPage title="Enquiries" description="Watch enquiry volume, spot spam and block a phone or email.">
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(
          [
            ["Last 24 hours", volume.d1],
            ["Last 7 days", volume.d7],
            ["Last 30 days", volume.d30],
            ["Blocked contacts", volume.blocked],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="card p-4">
            <dt className="text-caption text-ink-soft">{k}</dt>
            <dd className="font-display text-[26px] font-semibold tabular-nums leading-tight">{v.toLocaleString("en-IN")}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="spam-h" className="mt-6">
        <h2 id="spam-h" className="text-title font-semibold">
          Spam signals
        </h2>
        <p className="text-body text-ink-soft">One phone sending to more than {SPAM_VENDORS} vendors within an hour (last 30 days).</p>
        {spam.length === 0 ? (
          <p className="card mt-3 text-body text-ink-soft">No spam bursts found.</p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2" data-testid="spam-signals">
            {spam.map((s) => (
              <li key={s.phone} className="card p-4 border-danger/30 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">{s.phone}</p>
                  <p className="text-caption text-ink-soft">
                    {s.enquiries} enquiries to {s.vendors} vendors · last {ago(s.last_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link className="btn btn-ghost btn-sm" href={`/admin/enquiries${qs({ q: s.phone, range: "all" })}`}>
                    View
                  </Link>
                  {s.blocked ? <StatusChip status="suspended" label="blocked" /> : <BlockButton value={s.phone} compact />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-h" className="mt-8">
        <h2 id="recent-h" className="text-title font-semibold">
          Recent enquiries
        </h2>
        <form method="get" action="/admin/enquiries" role="search" className="card p-4 mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] lg:items-end">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="enq-q" className="label">
              Search
            </label>
            <input id="enq-q" name="q" type="search" className="field" defaultValue={f.q ?? ""} placeholder="Name, phone, email or vendor" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="enq-range" className="label">
              Period
            </label>
            <select id="enq-range" name="range" className="field" defaultValue={f.range}>
              {RANGES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 min-h-11 text-body cursor-pointer">
            <input type="checkbox" name="spam" value="1" defaultChecked={f.spam} className="w-5 h-5 accent-[var(--color-accent)]" />
            Spam only
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1 lg:flex-none">
              Apply
            </button>
            {filtered && (
              <Link href="/admin/enquiries" className="btn btn-secondary">
                Clear
              </Link>
            )}
          </div>
        </form>

        <div className="mt-4">
          {list.rows.length === 0 ? (
            <AdminEmptyState
              title={filtered ? "No enquiries match" : "No enquiries in the last 30 days"}
              body={filtered ? "Try a longer period or clear the filters." : "Enquiries customers send to vendors appear here."}
              action={filtered ? { href: "/admin/enquiries", label: "Clear filters" } : undefined}
            />
          ) : (
            <ul className="border border-line rounded-card divide-y divide-line bg-white" data-testid="enquiry-list">
              {list.rows.map((q) => (
                <li key={q.id} className="px-4 py-3 grid gap-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center" data-spam={q.spam ? "1" : undefined}>
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {q.name}{" "}
                      {q.spam && <span className="chip bg-danger-tint text-danger font-medium ml-1">Spam</span>}
                      {q.blocked && <span className="chip font-medium ml-1">Blocked</span>}
                    </p>
                    <p className="text-caption text-ink-soft truncate tabular-nums">
                      {q.phone}
                      {q.contact_email || q.customer_email ? ` · ${q.contact_email ?? q.customer_email}` : ""}
                      {q.customer_id ? (
                        <>
                          {" · "}
                          <Link href={`/admin/users/${q.customer_id}`} className="underline underline-offset-2 hover:text-foreground">
                            account
                          </Link>
                        </>
                      ) : (
                        " · guest"
                      )}
                    </p>
                  </div>
                  <div className="min-w-0 text-body">
                    <Link href={`/admin/vendors/${q.vendor_id}`} className="font-medium hover:underline underline-offset-2 truncate block">
                      {q.vendor_name}
                    </Link>
                    <p className="text-caption text-ink-soft truncate">
                      {q.district ?? "No district"} · event {q.event_date ? fmtDate(q.event_date) : "date not set"}
                    </p>
                  </div>
                  <div className="text-caption text-ink-soft flex flex-wrap items-center gap-2">
                    <StatusChip status={q.status === "pending" ? "pending" : q.status === "declined" ? "rejected" : "approved"} label={q.status} />
                    <span>{fmtDateTime(q.created_at)}</span>
                  </div>
                  <div className="md:justify-self-end">
                    {!q.blocked && <BlockButton value={q.phone} label="Block phone" compact />}
                  </div>
                  {q.message && <p className="text-caption text-ink-soft md:col-span-4 break-words line-clamp-2">{q.message}</p>}
                </li>
              ))}
            </ul>
          )}
          <Pager path="/admin/enquiries" filters={filters} page={list.page} pages={list.pages} total={list.total} noun="enquiry" />
        </div>
      </section>

      <section aria-labelledby="blocked-h" className="mt-8">
        <h2 id="blocked-h" className="text-title font-semibold">
          Blocked contacts
        </h2>
        <p className="text-body text-ink-soft">Enquiries from these phones and emails are refused.</p>
        <div className="card mt-3">
          <BlockForm />
        </div>
        {blocked.length === 0 ? (
          <p className="mt-3 text-body text-ink-soft">Nothing blocked yet.</p>
        ) : (
          <ul className="mt-3 border border-line rounded-card divide-y divide-line bg-white" data-testid="blocked-list">
            {blocked.map((b) => (
              <li key={b.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium break-all tabular-nums">{b.value}</p>
                  <p className="text-caption text-ink-soft break-words">
                    {b.reason} · {b.created_by_name ? `by ${b.created_by_name}, ` : ""}
                    {fmtDate(b.created_at)}
                  </p>
                </div>
                <UnblockButton id={b.id} value={b.value} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminPage>
  );
}
