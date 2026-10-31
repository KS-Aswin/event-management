import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { findUserById } from "@/lib/db";
import SettingsForm from "./settings-form";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/settings");

  const user = await findUserById(session.userId);
  if (!user) redirect("/login?next=/settings");

  const quickLinks =
    user.role === "vendor"
      ? [
          { href: "/dashboard/edit-listing", label: "Edit listing" },
          { href: "/dashboard", label: "Leads" },
        ]
      : [
          { href: "/dashboard", label: "My quote requests" },
          { href: "/dashboard", label: "Saved vendors" },
        ];

  return (
    <main className="max-w-[760px] mx-auto px-4 sm:px-6 py-10 w-full">
      <h1 className="text-[26px] font-semibold mb-1">Settings</h1>
      <p className="text-ink-soft text-sm mb-4">Manage your account and preferences.</p>
      <nav aria-label="Quick links" className="flex flex-wrap gap-2 mb-6">
        {quickLinks.map((l) => (
          <Link
            key={l.label}
            href={l.href}
            className="inline-flex items-center min-h-11 px-3.5 rounded-full border border-line text-[13px] text-ink-soft hover:border-accent hover:text-accent transition-colors"
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <SettingsForm
        initialName={user.name}
        initialEmail={user.email}
        initialEmailNotifications={user.email_notifications}
        initialSmsNotifications={user.sms_notifications}
      />
    </main>
  );
}
