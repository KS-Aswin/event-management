import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const firstName = session.name.split(" ")[0];

  return (
    <main className="max-w-2xl mx-auto px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold">Welcome back, {firstName}</h1>

      {session.role === "vendor" ? (
        <>
          <p className="text-ink-soft text-sm mt-1 mb-6">
            Here&apos;s how your listing is performing this month.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-4">
            <Stat num="1,204" label="Profile visitors" />
            <Stat num="37" label="Leads received" />
            <Stat num="24%" label="Conversion rate" />
            <Stat num="4.8" label="Average rating" />
          </div>
          <div className="border border-line rounded-xl p-5.5 mb-4">
            <h3 className="text-[15px] font-semibold mb-2.5">Recent enquiries</h3>
            <EnquiryRow dot="pending" text="Aiswarya M. — Wedding, 600 guests, Kochi — awaiting your reply" />
            <EnquiryRow dot="done" text="Nikhil R. — Reception, 300 guests — quote sent" />
            <EnquiryRow dot="done" text="Priya S. — Engagement, 150 guests — booking confirmed" last />
          </div>
          <p className="text-xs text-ink-soft mb-4">
            These sample stats are placeholder content — real vendor analytics (tied to actual quote
            requests in the database) haven&apos;t been built yet.
          </p>
        </>
      ) : (
        <>
          <p className="text-ink-soft text-sm mt-1 mb-6">Here&apos;s what&apos;s happening with your event.</p>
          <div className="border border-line rounded-xl p-5.5 mb-4">
            <h3 className="text-[15px] font-semibold mb-2.5">
              Sample event — 14 March 2027, Kochi
            </h3>
            <EnquiryRow dot="done" text="Venue — booked (Backwater Grand Palace)" />
            <EnquiryRow dot="done" text="Photography — booked (Studio Frames by Arun)" />
            <EnquiryRow dot="pending" text="Catering — quote requested, awaiting reply" />
            <EnquiryRow dot="pending" text="Decoration — not started" />
            <EnquiryRow dot="pending" text="DJ & Music — not started" last />
          </div>
          <p className="text-xs text-ink-soft mb-4">
            This checklist is sample content — once quote requests are tied to a real
            &quot;my events&quot; feature, this will reflect your actual bookings.
          </p>
        </>
      )}

      <div className="flex gap-3">
        <Link href="/search" className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm">
          Browse vendors
        </Link>
        <Link href="/settings" className="px-4.5 py-2.5 rounded-md bg-gray-100 hover:bg-gray-200 text-sm">
          Settings
        </Link>
      </div>
    </main>
  );
}

function Stat({ num, label }: { num: string; label: string }) {
  return (
    <div className="border border-line rounded-lg p-4">
      <div className="text-[22px] font-semibold text-accent">{num}</div>
      <div className="text-[12.5px] text-ink-soft mt-0.5">{label}</div>
    </div>
  );
}

function EnquiryRow({ dot, text, last }: { dot: "done" | "pending"; text: string; last?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 py-2 text-sm ${!last ? "border-b border-line" : ""}`}>
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${dot === "done" ? "bg-accent" : "bg-gold"}`}
      />
      {text}
    </div>
  );
}
