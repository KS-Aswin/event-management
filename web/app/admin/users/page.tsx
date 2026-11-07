import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage, AdminEmptyState } from "@/app/admin/_components/admin-page";
import { cleanUserFilters, searchUsers, USER_ROLES, USER_STATUSES } from "@/lib/admin/ops";
import { fmtDate, Pager, StatusChip } from "./_components/ui";

export const metadata: Metadata = { title: "Users" };

// P1-9: search users by name, email or phone; filter by role, status and
// join date. Each row opens /admin/users/[id] for suspend / force logout.
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const f = cleanUserFilters(await searchParams);
  const data = await searchUsers(f);
  const filters = { q: f.q, role: f.role, status: f.status, joined: f.joined };
  const filtered = Boolean(f.q || f.role || f.status || f.joined);

  return (
    <AdminPage title="Users" description="Find any account by name, email or phone. Open one to suspend it or sign it out.">
      <form method="get" action="/admin/users" role="search" className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="users-q" className="label">
            Search
          </label>
          <input
            id="users-q"
            name="q"
            type="search"
            className="field"
            defaultValue={f.q ?? ""}
            placeholder="Name, email or phone"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="users-role" className="label">
            Role
          </label>
          <select id="users-role" name="role" className="field" defaultValue={f.role ?? ""}>
            <option value="">All roles</option>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="users-status" className="label">
            Status
          </label>
          <select id="users-status" name="status" className="field" defaultValue={f.status ?? ""}>
            <option value="">Any status</option>
            {USER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="users-joined" className="label">
            Joined
          </label>
          <select id="users-joined" name="joined" className="field" defaultValue={f.joined ?? ""}>
            <option value="">Any time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <button type="submit" className="btn btn-primary flex-1 lg:flex-none">
            Search
          </button>
          {filtered && (
            <Link href="/admin/users" className="btn btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="mt-5">
        {data.rows.length === 0 ? (
          <AdminEmptyState
            title={filtered ? "No users match" : "No users yet"}
            body={filtered ? "Try a shorter search or clear the filters." : "Accounts appear here as people sign up."}
            action={filtered ? { href: "/admin/users", label: "Clear filters" } : undefined}
          />
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[minmax(0,2.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.9fr)] gap-4 px-4 pb-2 eyebrow">
              <span>User</span>
              <span>Role</span>
              <span>Status</span>
              <span>Listing</span>
              <span>Joined</span>
            </div>
            <ul className="border border-line rounded-card divide-y divide-line bg-white overflow-hidden" data-testid="users-list">
              {data.rows.map((u) => (
                <li key={u.id}>
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="grid gap-x-4 gap-y-1 px-4 py-3 min-h-11 hover:bg-surface-muted focus-visible:bg-surface-muted grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,2.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.9fr)] lg:items-center"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium truncate">{u.name}</span>
                      <span className="block text-caption text-ink-soft truncate">
                        {u.email}
                        {u.phone_e164 ? ` · ${u.phone_e164}` : ""}
                      </span>
                    </span>
                    <span className="text-body capitalize justify-self-end lg:justify-self-auto">{u.role}</span>
                    <span className="lg:order-none">
                      <StatusChip status={u.status} />
                    </span>
                    <span className="text-caption lg:text-body text-ink-soft min-w-0 truncate justify-self-end lg:justify-self-auto">
                      {u.listing_name ? (
                        <>
                          {u.listing_name}{" "}
                          <span className="text-ink-soft">({u.listing_status?.replace(/_/g, " ")})</span>
                        </>
                      ) : (
                        <span className="lg:inline hidden">–</span>
                      )}
                    </span>
                    <span className="text-caption text-ink-soft col-span-2 lg:col-span-1">Joined {fmtDate(u.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pager path="/admin/users" filters={filters} page={data.page} pages={data.pages} total={data.total} noun="user" />
      </div>
    </AdminPage>
  );
}
