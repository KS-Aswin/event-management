"use client";

import { useId, useState } from "react";

// Shared form fields for the sign-in and sign-up pages. Each field gets a
// stable id from useId() so the <label> is linked to its input, and a name
// attribute so password managers can pair email and password correctly.

export const inputClass =
  "w-full px-3 py-2.5 border border-line rounded-md text-base sm:text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40";

export function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required,
  autoComplete,
  hint,
  inputMode,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const isEmail = type === "email";
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] text-ink-soft mb-1.5">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode ?? (isEmail ? "email" : undefined)}
        autoCapitalize={isEmail ? "none" : undefined}
        spellCheck={isEmail ? false : undefined}
        aria-describedby={hint ? hintId : undefined}
        className={inputClass}
      />
      {hint && (
        <p id={hintId} className="text-xs text-ink-soft mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}

export function PasswordField({
  value,
  onChange,
  autoComplete,
  minLength,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] text-ink-soft mb-1.5">
        Password
      </label>
      <div className="relative">
        <input
          id={id}
          name="password"
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          aria-describedby={hint ? hintId : undefined}
          className={`${inputClass} pr-16`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          aria-label="Show password"
          aria-controls={id}
          className="absolute right-0 top-0 h-full min-h-11 px-3 text-xs text-ink-soft hover:text-foreground rounded-r-md outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-ink-soft mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
