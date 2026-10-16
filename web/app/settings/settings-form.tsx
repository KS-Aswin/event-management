"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SettingsForm({
  initialName,
  initialEmail,
  initialEmailVerified,
  initialEmailNotifications,
  initialSmsNotifications,
}: {
  initialName: string;
  initialEmail: string;
  initialEmailVerified: boolean;
  initialEmailNotifications: boolean;
  initialSmsNotifications: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [emailNotifications, setEmailNotifications] = useState(initialEmailNotifications);
  const [smsNotifications, setSmsNotifications] = useState(initialSmsNotifications);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(initialEmailVerified);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
    setVerified(data.user?.emailVerified ?? verified);
    showToast("Settings saved");
    router.refresh();
  }

  async function resendVerification() {
    const res = await fetch("/api/account/verify-email", { method: "POST" });
    const data = await res.json();
    showToast(res.ok ? "Verification email sent." : data.error ?? "Could not send the email.");
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPasswordError(data.error ?? "Something went wrong.");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    showToast("Password changed");
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setDeleteError(null);
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: deletePassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      setDeleteError(data.error ?? "Something went wrong.");
      return;
    }
    router.push("/");
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
          {!verified && (
            <p className="text-[13px] text-ink-soft">
              Your email isn&apos;t verified yet.{" "}
              <button type="button" onClick={resendVerification} className="text-accent hover:underline">
                Resend verification email
              </button>
            </p>
          )}
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
        <h3 className="text-[15px] font-semibold mb-3">Change password</h3>
        {passwordError && (
          <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {passwordError}
          </div>
        )}
        <form onSubmit={changePassword} className="space-y-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="Current password"
            className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            placeholder="New password (8–72 characters)"
            className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium"
          >
            Change password
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
            onClick={() => setDeleting((v) => !v)}
            className="px-4 py-2 rounded-md bg-red-50 hover:bg-red-100 text-red-700 text-sm"
          >
            Delete account
          </button>
        </div>
        {deleting && (
          <form onSubmit={deleteAccount} className="mt-4 space-y-3">
            <p className="text-[13px] text-ink-soft">
              This permanently deletes your account and, for vendors, your listing and all its leads. Enter
              your password to confirm.
            </p>
            {deleteError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                {deleteError}
              </div>
            )}
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Your password"
              className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-red-400"
            />
            <button type="submit" className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm">
              Permanently delete my account
            </button>
          </form>
        )}
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
