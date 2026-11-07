import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getLiveSession } from "@/app/api/_lib/auth";
import { findQuoteRequestsByCustomer, findFavoritesByCustomer } from "@/lib/db";
import { MyRequestsAndFavorites } from "./my-requests";

export const metadata: Metadata = { title: "My enquiries" };

// Customer dashboard: the quote requests a customer sent and the vendors they
// saved. Vendors work in /vendor and admins in /admin (proxy.ts redirects
// them; this page re-checks). The old vendor pages under /dashboard/* are
// gone; their URLs 308-redirect to /vendor/* (app/_nav/routes.ts). /my (P2-1)
// replaces this page for customers.
export default async function DashboardPage() {
  const session = await getLiveSession();
  if (!session) redirect("/login?next=%2Fdashboard");
  if (session.role === "vendor") redirect("/vendor");
  if (session.role === "admin") redirect("/admin");

  const [quotes, favorites] = await Promise.all([
    findQuoteRequestsByCustomer(session.userId),
    findFavoritesByCustomer(session.userId),
  ]);
  const firstName = session.name.split(" ")[0];
  const isNew = quotes.length === 0 && favorites.length === 0;

  return (
    <main className="page-narrow py-8 sm:py-12">
      <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">
        {isNew ? `Welcome, ${firstName}` : `Welcome back, ${firstName}`}
      </h1>
      <p className="text-ink-soft mt-1.5 mb-8">Track your quote requests and saved vendors.</p>
      <MyRequestsAndFavorites quotes={quotes} favorites={favorites} />
      <Link href="/search" className="btn btn-primary w-full sm:w-auto mt-2">
        Browse vendors
      </Link>
    </main>
  );
}
