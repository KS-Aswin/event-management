import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage } from "@/app/admin/_components/admin-page";

export const metadata: Metadata = { title: "Not found", robots: { index: false, follow: false } };

// QA-052: a missing or malformed record inside the admin console (old audit
// or dashboard links, a deleted user, a typo in the id). Rendered inside the
// admin layout, so the admin keeps the console navigation; proxy.ts makes the
// HTTP status a real 404 for /admin/vendors/<id> and /admin/users/<id>.
export default function AdminNotFound() {
  return (
    <AdminPage eyebrow="404" title="This record doesn't exist">
      <div className="card max-w-xl">
        <p className="text-body text-ink-soft">
          There is no listing or user with this id. It may have been deleted, or the link has a typo. Old links in the audit
          log keep pointing at records that are gone.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link href="/admin/vendors" className="btn btn-primary">
            Vendors
          </Link>
          <Link href="/admin/users" className="btn btn-secondary">
            Users
          </Link>
          <Link href="/admin" className="btn btn-secondary">
            Admin home
          </Link>
        </div>
      </div>
    </AdminPage>
  );
}
