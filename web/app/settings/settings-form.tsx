"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const inputClass =
  "w-full px-3 py-2.5 border border-line rounded-md text-base sm:text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40";

type PrefKey = "emailNotifications" | "smsNotifications";

export default function SettingsForm({
  initialName,
  initialEmail,
  initialEmailNotifications,
}: {
  initialName: string;
  initialEmail: string;
  initialEmailNotifications: boolean;
  // Accepted for compatibility; SMS is disabled until accounts have a phone number.
  initialSmsNotifications?: boolean;
}) {
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  // Last values the server confirmed, used to disable Save when nothing changed.
  const [saved, setSaved] = useState({ name: initialName, email: initialEmail });
  const [emailNotifications, setEmailNotifications] = useState(initialEmailNotifications);
  const [pending, setPending] = useState<Record<PrefKey, boolean>>({
    emailNotifications: false,
    smsNotifications: false,
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  const trimmedName = name.trim();
  const normalisedEmail = email.trim().toLowerCase();
  const unchanged = trimmedName === saved.name && normalisedEmail === saved.email.toLowerCase();

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (trimmedName.length < 2) {
      setError("Please enter your name.");
      return;
    }
    if (!normalisedEmail) {
      setError("Please enter your email.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, email: normalisedEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      // Show exactly what was stored, so the form never shows a value the
      // server ignored.
      const stored = {
        name: typeof data.user?.name === "string" ? data.user.name : trimmedName,
        email: typeof data.user?.email === "string" ? data.user.email : normalisedEmail,
      };
      setName(stored.name);
      setEmail(stored.email);
      setSaved(stored);
      showToast("Settings saved");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePref(key: PrefKey, value: boolean) {
    if (pending[key]) return;
    // Only email is togglable today (SMS needs a phone number on the account).
    const set = setEmailNotifications;
    const previous = !value;
    set(value);
    setPending((p) => ({ ...p, [key]: true }));
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      set(previous);
      showToast("Couldn't save preference. Please try again.");
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="border border-line rounded-xl p-5.5">
        <h2 className="text-[15px] font-semibold mb-3">Profile</h2>
        {error && (
          <div role="alert" className="mb-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <form onSubmit={saveProfile} className="space-y-3">
          <div>
            <label htmlFor={nameId} className="block text-[13px] text-ink-soft mb-1.5">
              Full name
            </label>
            <input
              id={nameId}
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={emailId} className="block text-[13px] text-ink-soft mb-1.5">
              Email
            </label>
            <input
              id={emailId}
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={saving || unchanged}
            className="min-h-11 px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-70 disabled:hover:bg-accent disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      </section>

      <section className="border border-line rounded-xl p-5.5">
        <h2 className="text-[15px] font-semibold mb-1">Notifications</h2>
        <ToggleRow
          label="Email notifications"
          checked={emailNotifications}
          disabled={pending.emailNotifications}
          onChange={(v) => togglePref("emailNotifications", v)}
        />
        {/* There is no phone number on the account yet, so SMS can't be
            delivered. Keep the switch visible but off until a phone field exists. */}
        <ToggleRow
          label="SMS notifications"
          description="Add a phone number to get SMS. Coming soon."
          checked={false}
          disabled
          onChange={() => {}}
          last
        />
      </section>

      <section className="border border-line rounded-xl p-5.5">
        <h2 className="text-[15px] font-semibold mb-3">Account</h2>
        <button
          onClick={logout}
          className="min-h-11 px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Log out
        </button>
        <div className="mt-4 pt-4 border-t border-line">
          <h3 className="text-[13px] font-semibold text-red-700 mb-1">Danger zone</h3>
          <p className="text-sm text-ink-soft">
            To delete your account, email{" "}
            <a
              href="mailto:help@vela.example?subject=Delete%20my%20account"
              className="text-accent hover:underline"
            >
              help@vela.example
            </a>{" "}
            from the address you signed up with.
          </p>
        </div>
      </section>

      <div role="status" aria-live="polite" className="contents">
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5.5 py-3 rounded-lg z-50">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
  last,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  const labelId = useId();
  const descId = useId();
  return (
    <div className={`flex items-center justify-between gap-3 py-1 text-sm ${!last ? "border-b border-line" : ""}`}>
      <div className="py-1.5">
        <span id={labelId}>{label}</span>
        {description && (
          <p id={descId} className="text-xs text-ink-soft mt-0.5">
            {description}
          </p>
        )}
      </div>
      {/* The 44px button is the hit area; the visible track stays small. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="group shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-full outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={`w-10 h-[22px] rounded-full relative transition-colors group-focus-visible:ring-2 group-focus-visible:ring-accent/40 group-focus-visible:ring-offset-2 ${
            checked ? "bg-accent" : "bg-gray-200"
          }`}
        >
          <span
            className={`w-4 h-4 rounded-full bg-white absolute top-[3px] transition-all ${
              checked ? "left-[21px]" : "left-[3px]"
            }`}
          />
        </span>
      </button>
    </div>
  );
}
