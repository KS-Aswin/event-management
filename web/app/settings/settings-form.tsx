"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SettingsForm({
  initialName,
  initialEmail,
  initialEmailNotifications,
  initialSmsNotifications,
}: {
  initialName: string;
  initialEmail: string;
  initialEmailNotifications: boolean;
  initialSmsNotifications: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [emailNotifications, setEmailNotifications] = useState(initialEmailNotifications);
  const [smsNotifications, setSmsNotifications] = useState(initialSmsNotifications);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    showToast("Settings saved");
    router.refresh();
  }

  async function togglePref(key: "emailNotifications" | "smsNotifications", value: boolean) {
    if (key === "emailNotifications") setEmailNotifications(value);
    else setSmsNotifications(value);
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="border border-line rounded-xl p-5.5">
        <h3 className="text-[15px] font-semibold mb-3">Profile</h3>
        {error && (
          <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <form onSubmit={saveProfile} className="space-y-3">
          <div>
            <label className="block text-[13px] text-ink-soft mb-1.5">Full name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-[13px] text-ink-soft mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-70"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>

      <div className="border border-line rounded-xl p-5.5">
        <h3 className="text-[15px] font-semibold mb-1">Notifications</h3>
        <ToggleRow
          label="Email notifications"
          checked={emailNotifications}
          onChange={(v) => togglePref("emailNotifications", v)}
        />
        <ToggleRow
          label="SMS notifications"
          checked={smsNotifications}
          onChange={(v) => togglePref("smsNotifications", v)}
          last
        />
      </div>

      <div className="border border-line rounded-xl p-5.5">
        <h3 className="text-[15px] font-semibold mb-3">Account</h3>
        <div className="flex gap-3">
          <button onClick={logout} className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm">
            Log out
          </button>
          <button
            onClick={() => showToast("This is a demo — account deletion isn't available.")}
            className="px-4 py-2 rounded-md bg-red-50 hover:bg-red-100 text-red-700 text-sm"
          >
            Delete account
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5.5 py-3 rounded-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  last,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-2.5 text-sm ${!last ? "border-b border-line" : ""}`}>
      {label}
      <button
        onClick={() => onChange(!checked)}
        aria-label={label}
        className={`w-10 h-[22px] rounded-full relative transition-colors shrink-0 ${
          checked ? "bg-accent" : "bg-gray-200"
        }`}
      >
        <span
          className={`w-4 h-4 rounded-full bg-white absolute top-[3px] transition-all ${
            checked ? "left-[21px]" : "left-[3px]"
          }`}
        />
      </button>
    </div>
  );
}
