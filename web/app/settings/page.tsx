import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { findUserById } from "@/lib/db";
import SettingsForm from "./settings-form";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await findUserById(session.userId);
  if (!user) redirect("/login");

  return (
    <main className="max-w-[760px] mx-auto px-6 py-10 w-full">
      <h1 className="text-[26px] font-semibold mb-1">Settings</h1>
      <p className="text-ink-soft text-sm mb-6">Manage your account and preferences.</p>
      <SettingsForm
        initialName={user.name}
        initialEmail={user.email}
        initialEmailNotifications={user.email_notifications}
        initialSmsNotifications={user.sms_notifications}
      />
    </main>
  );
}
