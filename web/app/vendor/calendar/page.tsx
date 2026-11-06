import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/app/api/_lib/auth";
import { getOwnVendor } from "@/lib/db";
import { getCalendarMonth, parseMonth, todayIst } from "@/lib/availability";
import CalendarClient from "./calendar-client";

export const metadata: Metadata = { title: "Calendar" };

// Vendor availability calendar (PRODUCT_PLAN P2-6, section 7 "Calendar"):
// month grid, block a day or a half-day slot, capacity per slot, bulk range
// block / unblock, booked days linked to their leads. Changes go through
// PUT /api/vendor/availability; the page re-renders from the server.
export default async function VendorCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session } = await requirePageRole("vendor");
  const vendor = await getOwnVendor(session.userId);
  const sp = await searchParams;
  const raw = typeof sp.month === "string" ? sp.month : null;
  const month = (raw && parseMonth(raw)) || todayIst().slice(0, 7);

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-5">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Calendar</h1>
        <p className="text-ink-soft text-lead mt-1 max-w-[62ch]">
          Block days you can&apos;t take and set how many events you can handle. Booked leads fill in on their own.
        </p>
      </header>
      {vendor ? (
        <CalendarClient data={await getCalendarMonth(vendor.id, month)} />
      ) : (
        <div className="card max-w-xl">
          <h2 className="text-title font-semibold">No listing yet</h2>
          <p className="text-body text-ink-soft mt-1">Create your listing first, then manage your dates here.</p>
          <Link href="/vendor/onboarding" className="btn btn-primary mt-4">
            Continue setup
          </Link>
        </div>
      )}
    </main>
  );
}
