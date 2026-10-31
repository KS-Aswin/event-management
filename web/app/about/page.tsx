import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description: "Vela is a marketplace for finding and comparing wedding and event vendors in Kerala.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="page-narrow py-10 sm:py-16">
      <p className="eyebrow text-accent mb-3">About</p>
      <h1 className="text-display sm:text-[32px] font-semibold mb-6">About Vela</h1>
      <div className="space-y-5 text-[16px] leading-[1.7] max-w-[65ch]">
        <p className="text-[17px] sm:text-[18px] leading-[1.6]">
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
      </div>
      <section
        aria-labelledby="not"
        className="mt-10 rounded-card border border-line bg-surface-muted p-5 sm:p-6 max-w-[65ch]"
      >
        <h2 id="not" className="text-title font-semibold mb-2">
          What we&apos;re not
        </h2>
        <p className="text-[16px] leading-[1.7]">
          We&apos;re not an event planning company and we don&apos;t take a cut of what you pay
          your vendor unless you ask us to arrange something extra. We&apos;re the place you go to
          find and compare the people who&apos;ll actually make your event happen.
        </p>
      </section>
      <div className="mt-10 flex flex-col sm:flex-row gap-3">
        <Link href="/search" className="btn btn-primary">
          Find vendors
        </Link>
        <Link href="/for-vendors" className="btn btn-secondary">
          List your business
        </Link>
      </div>
    </main>
  );
}
