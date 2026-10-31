import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "Vela is a marketplace for finding and comparing wedding and event vendors in Kerala.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="max-w-[760px] mx-auto px-4 sm:px-6 py-10 w-full">
      <h1 className="text-display font-semibold mb-6">About Vela</h1>
      <div className="space-y-3.5 text-body leading-relaxed">
        <p>
          Vela is a marketplace built for how people actually plan weddings and events in Kerala
          today — by asking around, comparing prices in WhatsApp groups, and hoping the
          photographer replies before the venue gets booked out.
        </p>
        <p>
          We bring venues, photographers, caterers, decorators, DJs, makeup artists, and every
          other vendor an event needs onto one platform, with transparent pricing, customer
          reviews, and a simple way to request quotes from several vendors at once.
        </p>
        <p>
          Vela started with weddings in Kerala and is built to grow with the people who use it —
          from a birthday for thirty guests to a wedding for a thousand.
        </p>
        <h2 className="text-lead font-semibold mt-5">What we&apos;re not</h2>
        <p>
          We&apos;re not an event planning company and we don&apos;t take a cut of what you pay
          your vendor unless you ask us to arrange something extra. We&apos;re the place you go to
          find and compare the people who&apos;ll actually make your event happen.
        </p>
      </div>
    </main>
  );
}
