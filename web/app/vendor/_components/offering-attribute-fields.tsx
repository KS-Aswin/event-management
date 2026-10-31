"use client";

import { useId, useState } from "react";
import type { AttributeFieldLite } from "./offering-api";

// Renders an offering's attribute form from the template / category schema
// (int, number, bool, text, enum, multi, tags). Values are kept in the shape
// the API validates: numbers, booleans, strings and string arrays.

const LANG_LABELS: Record<string, string> = { ml: "Malayalam", en: "English", ar: "Arabic", hi: "Hindi", ta: "Tamil" };

function optionLabel(v: string) {
  if (LANG_LABELS[v]) return LANG_LABELS[v];
  const s = v.replace(/[_-]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function OfferingAttributeFields({
  schema,
  values,
  onChange,
  errorKey,
  error,
}: {
  schema: AttributeFieldLite[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** "attributes.<key>" from the API, shown under that field. */
  errorKey?: string;
  error?: string;
}) {
  const uid = useId();
  if (!schema.length) return null;
  const set = (key: string, v: unknown) => {
    const next = { ...values };
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[key];
    else next[key] = v;
    onChange(next);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {schema.map((f) => {
        const id = `${uid}-${f.key}`;
        const err = errorKey === `attributes.${f.key}` ? error : undefined;
        const errId = err ? `${id}-err` : undefined;
        const label = (
          <>
            {f.label}
            {f.unit ? <span className="text-ink-soft font-normal"> ({f.unit})</span> : null}
            {f.required ? <span className="text-danger"> *</span> : null}
          </>
        );
        const errEl = err ? (
          <p id={errId} className="hint !text-danger" role="alert">
            {err}
          </p>
        ) : null;

        if (f.type === "bool") {
          return (
            <div key={f.key} className="flex items-start">
              <label htmlFor={id} className="flex items-center gap-3 min-h-11 cursor-pointer text-sm">
                <input
                  id={id}
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--color-accent)]"
                  checked={values[f.key] === true}
                  onChange={(e) => set(f.key, e.target.checked ? true : undefined)}
                />
                <span>{label}</span>
              </label>
              {errEl}
            </div>
          );
        }
        if (f.type === "enum") {
          return (
            <div key={f.key}>
              <label htmlFor={id} className="label">
                {label}
              </label>
              <select
                id={id}
                className="field"
                value={typeof values[f.key] === "string" ? (values[f.key] as string) : ""}
                aria-invalid={err ? true : undefined}
                aria-describedby={errId}
                onChange={(e) => set(f.key, e.target.value || undefined)}
              >
                <option value="">Not set</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {optionLabel(o)}
                  </option>
                ))}
              </select>
              {errEl}
            </div>
          );
        }
        if (f.type === "multi") {
          const cur = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [];
          return (
            <fieldset key={f.key} className="sm:col-span-2">
              <legend className="label">{label}</legend>
              <div className="flex flex-wrap gap-2">
                {(f.options ?? []).map((o) => {
                  const on = cur.includes(o);
                  return (
                    <label
                      key={o}
                      className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-control border text-sm cursor-pointer ${
                        on ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-accent)]"
                        checked={on}
                        onChange={(e) => set(f.key, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))}
                      />
                      {optionLabel(o)}
                    </label>
                  );
                })}
              </div>
              {errEl}
            </fieldset>
          );
        }
        if (f.type === "tags") {
          return (
            <TagsField
              key={f.key}
              id={id}
              label={label}
              value={Array.isArray(values[f.key]) ? (values[f.key] as string[]) : []}
              onChange={(v) => set(f.key, v)}
              err={errEl}
            />
          );
        }
        const numeric = f.type === "int" || f.type === "number";
        const raw = values[f.key];
        return (
          <div key={f.key}>
            <label htmlFor={id} className="label">
              {label}
            </label>
            <input
              id={id}
              className="field"
              type={numeric ? "number" : "text"}
              inputMode={numeric ? (f.type === "int" ? "numeric" : "decimal") : undefined}
              min={f.min}
              max={f.max}
              step={f.type === "int" ? 1 : "any"}
              value={raw === undefined || raw === null ? "" : String(raw)}
              aria-invalid={err ? true : undefined}
              aria-describedby={errId}
              onChange={(e) => {
                const s = e.target.value;
                if (!numeric) return set(f.key, s);
                set(f.key, s === "" ? undefined : Number(s));
              }}
            />
            {errEl}
          </div>
        );
      })}
    </div>
  );
}

function TagsField({
  id,
  label,
  value,
  onChange,
  err,
}: {
  id: string;
  label: React.ReactNode;
  value: string[];
  onChange: (v: string[]) => void;
  err: React.ReactNode;
}) {
  const [draft, setDraft] = useState(value.join(", "));
  return (
    <div className="sm:col-span-2">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        className="field"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() =>
          onChange(
            draft
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          )
        }
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="hint">
        Separate with commas.
      </p>
      {err}
    </div>
  );
}
