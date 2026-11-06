"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordField } from "@/app/login/auth-fields";

const inputClass = "field";

type PrefKey = "emailNotifications" | "smsNotifications";

export default function SettingsForm({
  initialName,
  initialEmail,
  initialEmailNotifications,
  supportEmail,
}: {
  initialName: string;
  initialEmail: string;
  initialEmailNotifications: boolean;
  /** lib/support.ts SUPPORT_EMAIL (QA-057), passed from the server page. */
  supportEmail: string;
  // Accepted for compatibility; SMS is disabled until accounts have a phone number.
  initialSmsNotifications?: boolean;
}) {
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  // Needed only when the sign-in email changes (QA-080).
  const [emailPassword, setEmailPassword] = useState("");
  // Last values the server confirmed, used to disable Save when nothing changed.
  const [saved, setSaved] = useState({
    name: initialName,
    email: initialEmail,
  });
  const [emailNotifications, setEmailNotifications] = useState(
    initialEmailNotifications,
  );
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
  const emailChanged = normalisedEmail !== saved.email.toLowerCase();
  const unchanged = trimmedName === saved.name && !emailChanged;

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
    if (emailChanged && !emailPassword) {
      setError("Enter your current password to change your email.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          email: normalisedEmail,
          ...(emailChanged ? { currentPassword: emailPassword } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      // Show exactly what was stored, so the form never shows a value the
      // server ignored.
      const stored = {
        name:
          typeof data.user?.name === "string" ? data.user.name : trimmedName,
        email:
          typeof data.user?.email === "string"
            ? data.user.email
            : normalisedEmail,
      };
      setName(stored.name);
      setEmail(stored.email);
      setSaved(stored);
      setEmailPassword("");
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

  const [signingOutOthers, setSigningOutOthers] = useState(false);
  async function signOutOthers() {
    if (signingOutOthers) return;
    setSigningOutOthers(true);
    try {
      const res = await fetch("/api/account/sign-out-others", { method: "POST" });
      showToast(res.ok ? "Signed out of all other devices" : "Couldn't sign out other devices. Please try again.");
    } catch {
      showToast("Could not reach the server. Please try again.");
    } finally {
      setSigningOutOthers(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="card sm:p-7">
        <SectionHeading title="Profile" />
        {error && (
          <div role="alert" className="alert-error mb-4">
            {error}
          </div>
        )}
        <form onSubmit={saveProfile}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={nameId} className="label">
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
              <label htmlFor={emailId} className="label">
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
            {emailChanged && (
              <div className="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
                <PasswordField
                  label="Current password"
                  name="current-password"
                  value={emailPassword}
                  onChange={setEmailPassword}
                  autoComplete="current-password"
                  hint="Needed to change the email you sign in with."
                />
              </div>
            )}
          </div>
          <div className="mt-5 pt-5 border-t border-line flex sm:justify-end">
            <button
              type="submit"
              disabled={saving || unchanged}
              className="btn btn-primary w-full sm:w-auto"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </section>

      <PasswordSection onDone={showToast} />

      <section className="card sm:p-7">
        <SectionHeading
          title="Notifications"
          description="Choose how Vela gets in touch with you."
        />
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

      <section className="card sm:p-7">
        <SectionHeading title="Account" />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-ink-soft">
            Sign out of Vela on this device.
          </p>
          <button
            type="button"
            onClick={logout}
            className="btn btn-secondary w-full sm:w-auto"
          >
            Log out
          </button>
        </div>
        <div className="mt-4 pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-ink-soft">
            Lost a phone or used a shared computer? Sign out everywhere except
            this device.
          </p>
          <button
            type="button"
            onClick={signOutOthers}
            disabled={signingOutOthers}
            className="btn btn-secondary w-full sm:w-auto shrink-0"
          >
            {signingOutOthers ? "Signing out…" : "Sign out of other devices"}
          </button>
        </div>
        <div className="mt-5 rounded-control border border-danger/25 bg-danger-tint/60 px-4 py-3.5">
          <h3 className="text-sm font-semibold text-danger mb-1">
            Danger zone
          </h3>
          <p className="text-sm text-ink-soft">
            To delete your account, email{" "}
            <a
              href={`mailto:${supportEmail}?subject=Delete%20my%20account`}
              className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover break-words"
            >
              {supportEmail}
            </a>{" "}
            from the address you signed up with.
          </p>
        </div>
      </section>

      <div role="status" aria-live="polite" className="contents">
        {toast && (
          <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] w-max max-w-[calc(100vw-2rem)] bg-foreground text-white text-sm font-medium px-5 py-3 rounded-card shadow-pop z-50">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Change password (QA-059). Needs the current password; every other device
 * is signed out and this one stays signed in.
 */
function PasswordSection({ onDone }: { onDone: (msg: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!current) return setError({ field: "currentPassword", message: "Enter your current password." });
    if (next.trim().length < 8) {
      return setError({ field: "newPassword", message: "New password must be at least 8 characters." });
    }
    if (next !== confirm) return setError({ field: "confirm", message: "The new passwords don't match." });
    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ field: data.field, message: data.error ?? "Something went wrong." });
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone("Password changed. Other devices were signed out.");
    } catch {
      setError({ message: "Could not reach the server. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card sm:p-7">
      <SectionHeading
        title="Password"
        description="Changing it signs you out on every other device."
      />
      {error && (
        <div role="alert" className="alert-error mb-4">
          {error.message}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
            <PasswordField
              label="Current password"
              name="current-password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              invalid={error?.field === "currentPassword"}
            />
          </div>
          <PasswordField
            label="New password"
            name="new-password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            minLength={8}
            hint="At least 8 characters."
            invalid={error?.field === "newPassword"}
          />
          <PasswordField
            label="Confirm new password"
            name="confirm-password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            invalid={error?.field === "confirm"}
          />
        </div>
        <div className="mt-5 pt-5 border-t border-line flex sm:justify-end">
          <button
            type="submit"
            disabled={busy || !current || !next || !confirm}
            className="btn btn-primary w-full sm:w-auto"
          >
            {busy ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
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
    <div
      className={`flex items-center justify-between gap-4 py-2 ${!last ? "border-b border-line" : ""}`}
    >
      <div className="py-1.5 min-w-0">
        <span id={labelId} className="text-[15px] font-medium text-foreground">
          {label}
        </span>
        {description && (
          <p id={descId} className="text-[13px] text-ink-soft mt-0.5">
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
          className={`block w-11 h-6 rounded-full relative transition-colors group-focus-visible:ring-2 group-focus-visible:ring-accent/40 group-focus-visible:ring-offset-2 ${
            checked ? "bg-accent" : "bg-line-strong"
          }`}
        >
          <span
            className={`size-[18px] rounded-full bg-white shadow-sm absolute top-[3px] left-[3px] transition-transform ${
              checked ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </span>
      </button>
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description && (
        <p className="text-sm text-ink-soft mt-1">{description}</p>
      )}
    </div>
  );
}
