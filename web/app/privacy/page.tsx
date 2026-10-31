import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Vela handles the information you share when you create an account or request a quote.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="max-w-[760px] mx-auto px-4 sm:px-6 py-10 w-full">
      <h1 className="text-display font-semibold mb-2">Privacy</h1>
      <p className="text-ink-soft text-sm mb-6">
        This app is still early in development — this page describes the intent, and will be
        replaced with a full policy before any real launch.
      </p>
      <div className="space-y-3.5 text-body leading-relaxed">
        <p>
          We collect the information you give us when you create an account or request a quote —
          your name, contact details, and event information — and share it only with the vendors
          you choose to contact.
        </p>
        <p>
          We don&apos;t sell your personal data to third parties. Vendors see your enquiry details
          only after you submit a quote request to them.
        </p>
        <h2 className="text-lead font-semibold mt-5">Your choices</h2>
        <p>
          You can update your account information at any time from Settings, and control whether
          you receive email or SMS notifications.
        </p>
      </div>
    </main>
  );
}
