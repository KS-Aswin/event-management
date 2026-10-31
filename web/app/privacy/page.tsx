import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Vela handles the information you share when you create an account or request a quote.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="page-narrow py-10 sm:py-16">
      <p className="eyebrow text-accent mb-3">Policy</p>
      <h1 className="text-display sm:text-[32px] font-semibold mb-5">Privacy</h1>
      <p className="mb-8 max-w-[36rem] rounded-card border border-gold/40 bg-gold/10 px-4 py-3 text-body">
        <span className="font-semibold text-gold-ink">Early draft. </span>
        This app is still early in development — this page describes the intent, and will be
        replaced with a full policy before any real launch.
      </p>
      <div className="space-y-5 text-[16px] leading-[1.7] max-w-[36rem]">
        <p>
          We collect the information you give us when you create an account or request a quote —
          your name, contact details, and event information — and share it only with the vendors
          you choose to contact.
        </p>
        <p>
          We don&apos;t sell your personal data to third parties. Vendors see your enquiry details
          only after you submit a quote request to them.
        </p>
        <h2 className="text-title font-semibold pt-5">Your choices</h2>
        <p>
          You can update your account information at any time from Settings, and control whether
          you receive email or SMS notifications.
        </p>
      </div>
    </main>
  );
}
