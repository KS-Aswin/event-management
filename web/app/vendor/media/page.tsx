import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findVendorByOwner } from "@/lib/db";
import MediaManager from "../_components/media-manager";

export const metadata: Metadata = { title: "Photos & videos" };

// P0-7: the vendor's media manager. The layout already guards role=vendor;
// the vendor id comes from the session, never from the URL.
export default async function VendorMediaPage() {
  const { session } = await requirePageRole("vendor");
  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/vendor/onboarding");

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-heading font-semibold tracking-tight sm:text-display">Photos &amp; videos</h1>
          <p className="mt-1 max-w-[60ch] text-lead text-ink-soft">
            Your best work sells for you. Add a cover, a logo and at least 6 photos; group events into albums.
          </p>
        </div>
        <Link href={`/vendors/${vendor.id}`} className="btn btn-secondary btn-sm">
          Preview public profile
        </Link>
      </header>
      <MediaManager vendorId={vendor.id} vendorStatus={vendor.status ?? "draft"} />
    </main>
  );
}
