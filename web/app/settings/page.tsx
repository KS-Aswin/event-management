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
    <main className="page-narrow w-full py-8 sm:py-12">
      <header className="mb-6 sm:mb-8">
        <h1 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-ink-soft text-[15px] mt-1.5">
          Manage your account and preferences.
        </p>
        <nav aria-label="Quick links" className="flex flex-wrap gap-2 mt-5">
          {quickLinks.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="group inline-flex items-center gap-1.5 min-h-11 sm:min-h-10 px-4 rounded-full border border-line-strong bg-surface text-sm text-foreground hover:border-accent hover:text-accent hover:bg-accent-tint transition-colors"
            >
              {l.label}
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="size-3.5 text-ink-soft group-hover:text-accent transition-colors"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </Link>
          ))}
        </nav>
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
