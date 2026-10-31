import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/app/api/_lib/auth";
import SettingsForm from "@/app/settings/settings-form";

export const metadata: Metadata = {
  title: "Settings",
};

// Account settings inside the workspace frame; reuses the shared /settings form.
export default async function VendorSettingsPage() {
  const { user } = await requirePageRole("vendor");

  return (
    <main className="page-narrow w-full !mx-0 py-6 sm:py-8">
      <header className="mb-6">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-ink-soft text-lead mt-1">
          Your sign-in details and notifications. Business details live in{" "}
          <Link href="/vendor/profile" className="text-accent font-medium hover:underline underline-offset-2">
            Profile &amp; business
          </Link>
          .
        </p>
      </header>
      <SettingsForm
        initialName={user.name}
        initialEmail={user.email}
        initialEmailNotifications={user.email_notifications}
        initialSmsNotifications={user.sms_notifications}
      />
    </main>
  );
}
