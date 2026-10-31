import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPage } from "@/app/admin/_components/admin-page";
import { requirePageRole } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { getUserDetail } from "@/lib/admin/ops";
import { ago, fmtDate, fmtDateTime, StatusChip } from "../_components/ui";
import UserActions from "../_components/user-actions";

export const metadata: Metadata = { title: "User" };

// P1-9 user detail: role, linked listing, activity counts, recent admin
// actions, and suspend / reinstate / sign out everywhere.
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [{ session }, user] = await Promise.all([requirePageRole("admin"), getUserDetail(id)]);
  if (!user) notFound();

  const facts: [string, React.ReactNode][] = [
    ["Email", <span key="e" className="break-all">{user.email}</span>],
    ["Phone", user.phone_e164 ?? "Not given"],
    ["Role", <span key="r" className="capitalize">{user.role}</span>],
    ["Joined", fmtDate(user.created_at)],
    ["Last sign-in", user.last_login_at ? `${fmtDateTime(user.last_login_at)} (${ago(user.last_login_at)})` : "Not recorded yet"],
    ["Enquiries sent", user.enquiries_sent],
    ...(user.listing_id ? ([["Enquiries received", user.enquiries_received]] as [string, React.ReactNode][]) : []),
    ["Reviews written", user.reviews_written],
  ];

  return (
    <AdminPage
      eyebrow="Users"
      title={user.name}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusChip status={user.status} />
          <span className="capitalize">{user.role}</span>
          <span aria-hidden="true">·</span>
          <span>User #{user.id}</span>
        </span>
      }
      actions={
        <Link href="/admin/users" className="btn btn-secondary">
          All users
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4 min-w-0">
          {user.status === "suspended" && (
            <div className="alert-error" role="note">
              <p className="font-medium">Suspended {user.suspended_at ? ago(user.suspended_at) : ""}</p>
              {user.suspended_reason && <p className="mt-0.5 break-words">{user.suspended_reason}</p>}
            </div>
          )}
          <section className="card" aria-labelledby="facts-h">
            <h2 id="facts-h" className="text-title font-semibold">
              Account
            </h2>
            <dl className="mt-3 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-body">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-soft">{k}</dt>
                  <dd className="min-w-0">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card" aria-labelledby="listing-h">
            <h2 id="listing-h" className="text-title font-semibold">
              Listing
            </h2>
            {user.listing_id ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{user.listing_name}</p>
                  <p className="mt-1">
                    <StatusChip status={user.listing_status ?? "draft"} />
                  </p>
                </div>
                <Link href={`/admin/vendors/${user.listing_id}`} className="btn btn-secondary">
                  Open listing
                </Link>
              </div>
            ) : (
              <p className="text-body text-ink-soft mt-1">
                {user.role === "vendor" ? "This vendor hasn't created a listing yet." : "No listing linked to this account."}
              </p>
            )}
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          <section className="card" aria-labelledby="actions-h">
            <h2 id="actions-h" className="text-title font-semibold mb-3">
              Actions
            </h2>
            <UserActions
              userId={user.id}
              name={user.name}
              status={user.status}
              isSelf={session.userId === user.id}
              hasListing={Boolean(user.listing_id)}
            />
          </section>

          <section className="card" aria-labelledby="history-h">
            <div className="flex items-center justify-between gap-3">
              <h2 id="history-h" className="text-title font-semibold">
                Admin history
              </h2>
              <Link href={`/admin/audit?entity=user&entityId=${user.id}`} className="btn btn-ghost btn-sm">
                Full log
              </Link>
            </div>
            {user.audit.length === 0 ? (
              <p className="text-body text-ink-soft mt-1">No admin actions on this account yet.</p>
            ) : (
              <ol className="mt-2 divide-y divide-line">
                {user.audit.map((a) => (
                  <li key={a.id} className="py-2.5 text-body">
                    <p>
                      <span className="font-medium">{a.action}</span>{" "}
                      <span className="text-ink-soft">by {a.actor_name ?? (a.actor_id ? `#${a.actor_id}` : "system")}</span>
                    </p>
                    {a.reason && <p className="text-ink-soft break-words">“{a.reason}”</p>}
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
