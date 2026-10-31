"use client";

import { useId, useState } from "react";

// Shared form fields for the sign-in and sign-up pages. Each field gets a
// stable id from useId() so the <label> is linked to its input, and a name
// attribute so password managers can pair email and password correctly.

// Shared .field look from globals.css, a touch taller on desktop for auth.
export const inputClass = "field sm:min-h-11";

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
      <label htmlFor={id} className="label">
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
        <p id={hintId} className="hint">
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
      <label htmlFor={id} className="label">
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
          className={`${inputClass} pr-[4.5rem]`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          aria-label="Show password"
          aria-controls={id}
          className="absolute right-1 top-1/2 -translate-y-1/2 min-h-11 sm:min-h-9 min-w-14 px-3 text-[13px] font-medium text-accent hover:bg-accent-tint rounded-control transition-colors"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
}
