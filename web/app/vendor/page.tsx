import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findListingMissing, findVendorByOwner } from "@/lib/db";

// Interim vendor home (P0 wave 1 gate). The full home with stats, leads and
// the setup checklist (P0-14) replaces this page in wave 2.
const MISSING_LABELS: Record<string, string> = {
  basics: "Add your business basics",
  offering: "Add at least one offering",
  logo_or_cover: "Upload a logo or cover photo",
  images: "Upload a few portfolio photos",
};

export default async function VendorHomePage() {
  const { session } = await requirePageRole("vendor");
  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/vendor/onboarding");
  const missing = await findListingMissing(vendor.id);

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-6">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="text-ink-soft text-lead mt-1">{vendor.name}</p>
      </header>

      {missing.length > 0 ? (
        <section className="card max-w-xl" aria-labelledby="setup-heading">
          <h2 id="setup-heading" className="text-title font-semibold">
            Finish your listing
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-body text-ink-soft">
            {missing.map((m) => (
              <li key={m}>{MISSING_LABELS[m] ?? m}</li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="card max-w-xl">
          <h2 className="text-title font-semibold">Your listing is complete</h2>
          <p className="text-body text-ink-soft mt-1">
            Customers can find you in search and send you enquiries.
          </p>
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={`/vendors/${vendor.id}?preview=1`} className="btn btn-secondary">
          Preview public profile
        </Link>
      </div>
    </main>
  );
}
