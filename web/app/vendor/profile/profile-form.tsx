"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VendorProfile } from "@/app/api/vendor/profile/shape";
import { LANGUAGE_OPTIONS, PROFILE_LIMITS } from "@/app/api/vendor/profile/validate";

// Business profile editor. Each section saves on its own (PATCH
// /api/vendor/profile with just that section's fields), so a vendor on a
// phone never loses one section's edits to another section's error.

type Option = { id: number; name: string };

type Values = {
  vendorType: "company" | "individual";
  name: string;
  legalName: string;
  primaryCategoryId: string;
  additionalCategoryIds: number[];
  about: string;
  yearsExperience: string;
  yearEstablished: string;
  teamSize: string;
  languages: string[];
  tags: string;
  phone: string;
  whatsapp: string;
  instagramUrl: string;
  youtubeUrl: string;
  websiteUrl: string;
  districtId: string;
  location: string;
  addressLine: string;
  landmark: string;
  pincode: string;
  maxGuests: string;
  maxEventsPerDay: string;
  gstin: string;
  fssaiNo: string;
};
type Key = keyof Values;

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function fromProfile(p: VendorProfile): Values {
  return {
    vendorType: p.vendorType === "company" ? "company" : "individual",
    name: p.name,
    legalName: s(p.legalName),
    primaryCategoryId: s(p.primaryCategoryId),
    additionalCategoryIds: p.additionalCategoryIds,
    about: p.about,
    yearsExperience: s(p.yearsExperience),
    yearEstablished: s(p.yearEstablished),
    teamSize: s(p.teamSize),
    languages: p.languages,
    tags: p.tags.join(", "),
    phone: s(p.phone),
    whatsapp: s(p.whatsapp),
    instagramUrl: s(p.instagramUrl),
    youtubeUrl: s(p.youtubeUrl),
    websiteUrl: s(p.websiteUrl),
    districtId: s(p.districtId),
    location: s(p.location),
    addressLine: s(p.addressLine),
    landmark: s(p.landmark),
    pincode: s(p.pincode),
    maxGuests: s(p.maxGuests),
    maxEventsPerDay: s(p.maxEventsPerDay),
    gstin: s(p.gstin),
    fssaiNo: s(p.fssaiNo),
  };
}

function toBody(keys: Key[], v: Values): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const k of keys) {
    const val = v[k];
    if (k === "tags") body.tags = (val as string).split(",").map((t) => t.trim()).filter(Boolean);
    else if (k === "primaryCategoryId" || k === "districtId") body[k] = val === "" ? undefined : Number(val);
    else body[k] = val;
  }
  return body;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const REREVIEW_KEYS: Key[] = ["name", "primaryCategoryId", "phone"];

export default function ProfileForm({
  initial,
  categories,
  districts,
}: {
  initial: VendorProfile;
  categories: Option[];
  districts: Option[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => fromProfile(initial));
  const [saved, setSaved] = useState<Values>(() => fromProfile(initial));
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, { ok: boolean; text: string } | undefined>>({});
  const [rereview, setRereview] = useState(initial.rereviewRequired);
  const [customLang, setCustomLang] = useState("");
  const formRefs = useRef<Record<string, HTMLFormElement | null>>({});
  const live = initial.status === "approved";

  const set = <K extends Key>(k: K, v: Values[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };
  const dirty = (keys: Key[]) => keys.some((k) => !same(values[k], saved[k]));

  async function save(section: string, keys: Key[]) {
    if (!dirty(keys)) return;
    setBusy(section);
    setNotice((n) => ({ ...n, [section]: undefined }));
    const changed = keys.filter((k) => !same(values[k], saved[k]));
    try {
      const res = await fetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toBody(changed, values)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const field = typeof data.field === "string" ? (data.field as Key) : null;
        const msg = typeof data.error === "string" ? data.error : "Couldn't save. Please try again.";
        if (field && keys.includes(field)) {
          setErrors((e) => ({ ...e, [field]: msg }));
          const el = formRefs.current[section]?.querySelector<HTMLElement>(`[name="${field}"]`);
          el?.focus();
        }
        setNotice((n) => ({ ...n, [section]: { ok: false, text: field && keys.includes(field) ? "Please fix the highlighted field." : msg } }));
        return;
      }
      const next = fromProfile(data.profile as VendorProfile);
      // Only the saved section takes the server's values; other sections keep unsaved edits.
      setSaved(next);
      setValues((prev) => {
        const merged = { ...prev };
        for (const k of keys) (merged as Record<Key, unknown>)[k] = next[k];
        return merged;
      });
      if (data.rereview) setRereview(true);
      setNotice((n) => ({
        ...n,
        [section]: {
          ok: true,
          text: data.rereview && changed.some((k) => REREVIEW_KEYS.includes(k))
            ? "Saved. Our team will take a quick look at this change; your listing stays live."
            : "Saved",
        },
      }));
      router.refresh();
    } catch {
      setNotice((n) => ({ ...n, [section]: { ok: false, text: "You seem to be offline. Nothing was saved." } }));
    } finally {
      setBusy(null);
    }
  }

  const field = (k: Key) => ({
    id: `pf-${k}`,
    name: k,
    "aria-invalid": errors[k] ? (true as const) : undefined,
    "aria-describedby": errors[k] ? `pf-${k}-err` : undefined,
  });
  const err = (k: Key) =>
    errors[k] ? (
      <p id={`pf-${k}-err`} className="text-caption text-danger mt-1.5">
        {errors[k]}
      </p>
    ) : null;

  const Section = ({
    id,
    title,
    description,
    keys,
    children,
  }: {
    id: string;
    title: string;
    description?: string;
    keys: Key[];
    children: React.ReactNode;
  }) => {
    const isDirty = dirty(keys);
    const n = notice[id];
    const touchesRereview = live && keys.some((k) => REREVIEW_KEYS.includes(k) && !same(values[k], saved[k]));
    return (
      <form
        ref={(el) => {
          formRefs.current[id] = el;
        }}
        id={id}
        aria-labelledby={`${id}-h`}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save(id, keys);
        }}
        className="card sm:p-6 scroll-mt-24"
      >
        <h2 id={`${id}-h`} className="text-title font-semibold">
          {title}
        </h2>
        {description && <p className="text-body text-ink-soft mt-0.5">{description}</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
        {touchesRereview && (
          <p className="mt-4 text-caption rounded-control bg-[#fdf8e7] border border-[#ecd98f] px-3 py-2">
            Your listing is live. A change to your business name, category or phone is checked by our team, and you stay
            live while we look.
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={!isDirty || busy === id}>
            {busy === id ? "Saving…" : "Save"}
          </button>
          {isDirty && busy !== id && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setValues((prev) => {
                  const r = { ...prev };
                  for (const k of keys) (r as Record<Key, unknown>)[k] = saved[k];
                  return r;
                });
                setErrors({});
                setNotice((x) => ({ ...x, [id]: undefined }));
              }}
            >
              Discard changes
            </button>
          )}
          <span aria-live="polite" className="text-caption">
            {n ? <span className={n.ok ? "text-accent" : "text-danger"}>{n.text}</span> : isDirty ? <span className="text-ink-soft">Unsaved changes</span> : null}
          </span>
        </div>
      </form>
    );
  };

  const full = "sm:col-span-2";
  const aboutLen = values.about.trim().length;

  // Rendered as plain function calls (not <Section/>) so inputs keep focus between keystrokes.
  return (
    <div className="flex flex-col gap-5 min-w-0">
      {rereview && live && (
        <p role="status" className="rounded-card border border-[#ecd98f] bg-[#fdf8e7] px-4 py-3 text-body">
          Our team is checking a recent change to your name, category or phone. Your listing stays live.
        </p>
      )}

      {Section({
        id: "about",
        title: "About your business",
        description: "The basics customers read first on your profile.",
        keys: ["vendorType", "name", "legalName", "primaryCategoryId", "additionalCategoryIds", "about", "yearsExperience", "yearEstablished", "teamSize", "languages", "tags"],
        children: (
          <>
            <fieldset className={full}>
              <legend className="label">You are</legend>
              <div className="grid grid-cols-2 gap-2 max-w-md">
                {(
                  [
                    ["individual", "An individual", "Freelancer or artist"],
                    ["company", "A company", "Registered business or team"],
                  ] as const
                ).map(([v, label, hint]) => (
                  <label
                    key={v}
                    className={`flex flex-col gap-0.5 rounded-control border px-3 py-2.5 cursor-pointer min-h-11 ${
                      values.vendorType === v ? "border-accent bg-accent-tint" : "border-line-strong hover:bg-surface-muted"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="radio"
                        name="vendorType"
                        value={v}
                        checked={values.vendorType === v}
                        onChange={() => set("vendorType", v)}
                        className="accent-[var(--color-accent)] size-4"
                      />
                      {label}
                    </span>
                    <span className="text-caption text-ink-soft pl-6">{hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={values.vendorType === "company" ? "" : full}>
              <label htmlFor="pf-name" className="label">
                Business name
              </label>
              <input {...field("name")} className="field" required maxLength={PROFILE_LIMITS.name} autoComplete="organization" value={values.name} onChange={(e) => set("name", e.target.value)} />
              {err("name")}
            </div>
            {values.vendorType === "company" && (
              <div>
                <label htmlFor="pf-legalName" className="label">
                  Registered name <span className="text-ink-soft font-normal">(optional)</span>
                </label>
                <input {...field("legalName")} className="field" maxLength={PROFILE_LIMITS.legalName} value={values.legalName} onChange={(e) => set("legalName", e.target.value)} />
                {err("legalName")}
              </div>
            )}
            <div className={full}>
              <label htmlFor="pf-primaryCategoryId" className="label">
                Main category
              </label>
              <select {...field("primaryCategoryId")} className="field sm:max-w-sm" value={values.primaryCategoryId} onChange={(e) => {
                const id = e.target.value;
                set("primaryCategoryId", id);
                set("additionalCategoryIds", values.additionalCategoryIds.filter((x) => String(x) !== id));
              }}>
                <option value="" disabled>
                  Choose a category
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {err("primaryCategoryId")}
            </div>
            <fieldset className={full}>
              <legend className="label">
                Other categories <span className="text-ink-soft font-normal">(optional, up to {PROFILE_LIMITS.additionalCategories})</span>
              </legend>
              <p className="hint -mt-1 mb-2">Also show up when customers search for these.</p>
              <div className="flex flex-wrap gap-2">
                {categories
                  .filter((c) => String(c.id) !== values.primaryCategoryId)
                  .map((c) => {
                    const on = values.additionalCategoryIds.includes(c.id);
                    const atLimit = !on && values.additionalCategoryIds.length >= PROFILE_LIMITS.additionalCategories;
                    return (
                      <label
                        key={c.id}
                        className={`inline-flex items-center gap-2 min-h-11 sm:min-h-9 px-3 rounded-full border text-[13px] cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                          on ? "border-accent bg-accent-tint text-accent-hover font-medium" : "border-line-strong hover:border-accent"
                        } ${atLimit ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          name="additionalCategoryIds"
                          checked={on}
                          disabled={atLimit}
                          onChange={() =>
                            set(
                              "additionalCategoryIds",
                              on ? values.additionalCategoryIds.filter((x) => x !== c.id) : [...values.additionalCategoryIds, c.id]
                            )
                          }
                        />
                        {on && <span aria-hidden="true">✓</span>}
                        {c.name}
                      </label>
                    );
                  })}
              </div>
              {err("additionalCategoryIds")}
            </fieldset>
            <div className={full}>
              <label htmlFor="pf-about" className="label">
                About your business
              </label>
              <textarea
                {...field("about")}
                aria-describedby={`pf-about-count${errors.about ? " pf-about-err" : ""}`}
                className="field"
                rows={6}
                maxLength={PROFILE_LIMITS.about}
                value={values.about}
                onChange={(e) => set("about", e.target.value)}
                placeholder="What you do, your style, the events you love working on, what's included…"
              />
              <p id="pf-about-count" className="hint flex justify-between gap-2">
                <span>{aboutLen < 150 ? `Aim for at least 150 characters (${150 - aboutLen} more).` : "Good length."}</span>
                <span className="tabular-nums">
                  {values.about.length}/{PROFILE_LIMITS.about}
                </span>
              </p>
              {err("about")}
            </div>
            <div>
              <label htmlFor="pf-yearsExperience" className="label">
                Years of experience
              </label>
              <input {...field("yearsExperience")} className="field" inputMode="numeric" pattern="[0-9]*" value={values.yearsExperience} onChange={(e) => set("yearsExperience", e.target.value.replace(/\D/g, "").slice(0, 2))} />
              {err("yearsExperience")}
            </div>
            <div>
              <label htmlFor="pf-yearEstablished" className="label">
                Year started <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("yearEstablished")} className="field" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 2015" value={values.yearEstablished} onChange={(e) => set("yearEstablished", e.target.value.replace(/\D/g, "").slice(0, 4))} />
              {err("yearEstablished")}
            </div>
            <div>
              <label htmlFor="pf-teamSize" className="label">
                Team size <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("teamSize")} className="field" inputMode="numeric" pattern="[0-9]*" value={values.teamSize} onChange={(e) => set("teamSize", e.target.value.replace(/\D/g, "").slice(0, 5))} />
              {err("teamSize")}
            </div>
            <div>
              <label htmlFor="pf-tags" className="label">
                Specialities <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("tags")} className="field" placeholder="Candid, Drone, Traditional" value={values.tags} onChange={(e) => set("tags", e.target.value)} />
              <p className="hint">Separate with commas. Up to {PROFILE_LIMITS.tags}.</p>
              {err("tags")}
            </div>
            <fieldset className={full}>
              <legend className="label">Languages you speak</legend>
              <div className="flex flex-wrap gap-2">
                {Array.from(new Set([...LANGUAGE_OPTIONS, ...values.languages])).map((lang) => {
                  const on = values.languages.some((l) => l.toLowerCase() === lang.toLowerCase());
                  return (
                    <label
                      key={lang}
                      className={`inline-flex items-center gap-2 min-h-11 sm:min-h-9 px-3 rounded-full border text-[13px] cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                        on ? "border-accent bg-accent-tint text-accent-hover font-medium" : "border-line-strong hover:border-accent"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        name="languages"
                        checked={on}
                        onChange={() =>
                          set("languages", on ? values.languages.filter((l) => l.toLowerCase() !== lang.toLowerCase()) : [...values.languages, lang])
                        }
                      />
                      {on && <span aria-hidden="true">✓</span>}
                      {lang}
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-2 max-w-sm">
                <label htmlFor="pf-lang-other" className="sr-only">
                  Add another language
                </label>
                <input
                  id="pf-lang-other"
                  className="field"
                  placeholder="Another language"
                  maxLength={PROFILE_LIMITS.languageLength}
                  value={customLang}
                  onChange={(e) => setCustomLang(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const t = customLang.trim();
                      if (t && !values.languages.some((l) => l.toLowerCase() === t.toLowerCase())) set("languages", [...values.languages, t]);
                      setCustomLang("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!customLang.trim()}
                  onClick={() => {
                    const t = customLang.trim();
                    if (t && !values.languages.some((l) => l.toLowerCase() === t.toLowerCase())) set("languages", [...values.languages, t]);
                    setCustomLang("");
                  }}
                >
                  Add
                </button>
              </div>
              {err("languages")}
            </fieldset>
          </>
        ),
      })}

      {Section({
        id: "contact",
        title: "Contact",
        description: "Customers who enquire can call or WhatsApp you on these numbers.",
        keys: ["phone", "whatsapp", "instagramUrl", "youtubeUrl", "websiteUrl"],
        children: (
          <>
            <div>
              <label htmlFor="pf-phone" className="label">
                Phone
              </label>
              <input {...field("phone")} className="field" type="tel" inputMode="tel" autoComplete="tel" placeholder="98470 12345" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
              <p className="hint">Indian mobile, or + and country code for other countries.</p>
              {err("phone")}
            </div>
            <div>
              <label htmlFor="pf-whatsapp" className="label">
                WhatsApp <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("whatsapp")} className="field" type="tel" inputMode="tel" placeholder="Same as phone?" value={values.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
              {values.phone && values.whatsapp !== values.phone && (
                <button type="button" className="btn btn-ghost btn-sm mt-1 -ml-3" onClick={() => set("whatsapp", values.phone)}>
                  Use my phone number
                </button>
              )}
              {err("whatsapp")}
            </div>
            <div>
              <label htmlFor="pf-instagramUrl" className="label">
                Instagram <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("instagramUrl")} className="field" type="url" inputMode="url" placeholder="instagram.com/yourpage" value={values.instagramUrl} onChange={(e) => set("instagramUrl", e.target.value)} />
              {err("instagramUrl")}
            </div>
            <div>
              <label htmlFor="pf-youtubeUrl" className="label">
                YouTube <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("youtubeUrl")} className="field" type="url" inputMode="url" placeholder="youtube.com/@yourchannel" value={values.youtubeUrl} onChange={(e) => set("youtubeUrl", e.target.value)} />
              {err("youtubeUrl")}
            </div>
            <div className={full}>
              <label htmlFor="pf-websiteUrl" className="label">
                Website <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("websiteUrl")} className="field sm:max-w-md" type="url" inputMode="url" placeholder="yourbusiness.in" value={values.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} />
              {err("websiteUrl")}
            </div>
          </>
        ),
      })}

      {Section({
        id: "location",
        title: "Location",
        description: "Your base. Customers in your home district see you first.",
        keys: ["districtId", "location", "addressLine", "landmark", "pincode"],
        children: (
          <>
            <div>
              <label htmlFor="pf-districtId" className="label">
                Home district
              </label>
              <select {...field("districtId")} className="field" value={values.districtId} onChange={(e) => set("districtId", e.target.value)}>
                <option value="" disabled>
                  Choose a district
                </option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {err("districtId")}
            </div>
            <div>
              <label htmlFor="pf-location" className="label">
                Town or area
              </label>
              <input {...field("location")} className="field" autoComplete="address-level2" placeholder="e.g. Kakkanad" maxLength={PROFILE_LIMITS.location} value={values.location} onChange={(e) => set("location", e.target.value)} />
              {err("location")}
            </div>
            <div className={full}>
              <label htmlFor="pf-addressLine" className="label">
                Address <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("addressLine")} className="field" autoComplete="street-address" maxLength={PROFILE_LIMITS.address} value={values.addressLine} onChange={(e) => set("addressLine", e.target.value)} />
              <p className="hint">Add it if you have a studio, shop or venue customers can visit.</p>
              {err("addressLine")}
            </div>
            <div>
              <label htmlFor="pf-landmark" className="label">
                Landmark <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("landmark")} className="field" placeholder="Near Infopark gate" maxLength={PROFILE_LIMITS.landmark} value={values.landmark} onChange={(e) => set("landmark", e.target.value)} />
              {err("landmark")}
            </div>
            <div>
              <label htmlFor="pf-pincode" className="label">
                PIN code <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("pincode")} className="field" inputMode="numeric" autoComplete="postal-code" pattern="[0-9]*" placeholder="682030" value={values.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} />
              {err("pincode")}
            </div>
          </>
        ),
      })}

      {Section({
        id: "capacity",
        title: "Capacity",
        description: "Helps customers with big events find vendors who can handle them.",
        keys: ["maxGuests", "maxEventsPerDay"],
        children: (
          <>
            <div>
              <label htmlFor="pf-maxGuests" className="label">
                Largest event you can handle (guests)
              </label>
              <input {...field("maxGuests")} className="field" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 1000" value={values.maxGuests} onChange={(e) => set("maxGuests", e.target.value.replace(/\D/g, "").slice(0, 6))} />
              {err("maxGuests")}
            </div>
            <div>
              <label htmlFor="pf-maxEventsPerDay" className="label">
                Events you can take on the same day
              </label>
              <input {...field("maxEventsPerDay")} className="field" inputMode="numeric" pattern="[0-9]*" value={values.maxEventsPerDay} onChange={(e) => set("maxEventsPerDay", e.target.value.replace(/\D/g, "").slice(0, 2))} />
              <p className="hint">With 2 or more teams, a booked day stays open for another booking.</p>
              {err("maxEventsPerDay")}
            </div>
          </>
        ),
      })}

      {Section({
        id: "registration",
        title: "Registration",
        description: "Optional. Customers trust registered businesses more.",
        keys: ["gstin", "fssaiNo"],
        children: (
          <>
            <div>
              <label htmlFor="pf-gstin" className="label">
                GSTIN <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input {...field("gstin")} className="field uppercase" autoCapitalize="characters" spellCheck={false} maxLength={15} placeholder="32ABCDE1234F1Z5" value={values.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase().replace(/\s/g, ""))} />
              {err("gstin")}
            </div>
            <div>
              <label htmlFor="pf-fssaiNo" className="label">
                FSSAI licence <span className="text-ink-soft font-normal">(caterers, optional)</span>
              </label>
              <input {...field("fssaiNo")} className="field" inputMode="numeric" pattern="[0-9]*" maxLength={14} value={values.fssaiNo} onChange={(e) => set("fssaiNo", e.target.value.replace(/\D/g, "").slice(0, 14))} />
              {err("fssaiNo")}
            </div>
          </>
        ),
      })}
    </div>
  );
}
