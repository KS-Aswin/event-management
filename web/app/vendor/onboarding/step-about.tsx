"use client";

import { useId, useState } from "react";
import { StepActions } from "./step-actions";
import type { StepProps } from "./types";

const LANGUAGES = ["Malayalam", "English", "Hindi", "Tamil", "Arabic", "Kannada"];
const ABOUT_MIN = 30;

/** "+919847012345" -> "98470 12345" for editing; other numbers as stored. */
function displayPhone(p: string | null | undefined) {
  if (!p) return "";
  const m = /^\+91(\d{5})(\d{5})$/.exec(p);
  return m ? `${m[1]} ${m[2]}` : p;
}

export default function StepAbout({ tax, data, saveListing, next }: StepProps) {
  const uid = useId();
  const l = data.listing;
  const [vendorType, setVendorType] = useState<"company" | "individual">(l?.vendorType ?? "individual");
  const [name, setName] = useState(l?.name ?? "");
  const [legalName, setLegalName] = useState(l?.legalName ?? "");
  const [primary, setPrimary] = useState(l?.primaryCategoryId ? String(l.primaryCategoryId) : "");
  const [districtId, setDistrictId] = useState(l?.districtId ? String(l.districtId) : "");
  const [town, setTown] = useState(l && l.location && !tax.districts.some((d) => d.name === l.location) ? l.location : "");
  const [phone, setPhone] = useState(displayPhone(l?.phone));
  const [sameWa, setSameWa] = useState(!l?.whatsapp || l.whatsapp === l.phone);
  const [whatsapp, setWhatsapp] = useState(displayPhone(l?.whatsapp));
  const [years, setYears] = useState(l?.yearsExperience != null ? String(l.yearsExperience) : "");
  const [yearStarted, setYearStarted] = useState(l?.yearEstablished != null ? String(l.yearEstablished) : "");
  const [teamSize, setTeamSize] = useState(l?.teamSize != null ? String(l.teamSize) : "");
  const [languages, setLanguages] = useState<string[]>(l?.languages?.length ? l.languages : ["Malayalam"]);
  const [about, setAbout] = useState(l?.about ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = "Enter your business name (as customers know it).";
    if (!primary) e.primaryCategoryId = "Choose what you mainly do.";
    if (!districtId) e.districtId = "Choose your home district.";
    if (phone.replace(/\D/g, "").length < 10) e.phone = "Enter a 10-digit mobile number.";
    if (!sameWa && whatsapp && whatsapp.replace(/\D/g, "").length < 10) e.whatsapp = "Enter a 10-digit WhatsApp number.";
    if (about.trim().length < ABOUT_MIN) e.about = `Write at least ${ABOUT_MIN} characters so customers know who you are.`;
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0];
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      vendorType,
      name: name.trim(),
      legalName: vendorType === "company" ? legalName.trim() || null : null,
      primaryCategoryId: Number(primary),
      districtId: Number(districtId),
      location: town.trim() || tax.districts.find((d) => d.id === Number(districtId))?.name || "",
      phone,
      whatsapp: sameWa ? phone : whatsapp || null,
      yearsExperience: years === "" ? null : Number(years),
      yearEstablished: vendorType === "company" && yearStarted !== "" ? Number(yearStarted) : null,
      teamSize: teamSize === "" ? null : Number(teamSize),
      languages,
      about: about.trim(),
      onboardingStep: 2,
    };
    const r = await saveListing(body);
    setBusy(false);
    if (!r.ok) {
      if (r.field) {
        setErrors({ [r.field]: r.error });
        document.getElementById(`${uid}-${r.field}`)?.focus();
      } else setFormError(r.error);
      return;
    }
    await next();
  }

  const err = (k: string) =>
    errors[k] ? (
      <p id={`${uid}-${k}-err`} className="hint !text-danger" role="alert">
        {errors[k]}
      </p>
    ) : null;
  const aria = (k: string, hint?: boolean) => ({
    "aria-invalid": errors[k] ? (true as const) : undefined,
    "aria-describedby": [errors[k] ? `${uid}-${k}-err` : "", hint ? `${uid}-${k}-hint` : ""].filter(Boolean).join(" ") || undefined,
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <p className="text-lead text-ink-soft -mt-3">
        This is what customers see first. You can change any of it later.
      </p>

      <fieldset>
        <legend className="label">You are</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["individual", "An individual", "Photographer, makeup artist, priest, solo performer…"],
              ["company", "A company or team", "Event company, caterer, studio, troupe, rental shop…"],
            ] as const
          ).map(([v, t, h]) => (
            <label
              key={v}
              className={`flex gap-3 p-4 rounded-card border cursor-pointer transition-colors ${
                vendorType === v ? "border-accent bg-accent-tint" : "border-line-strong hover:border-accent"
              }`}
            >
              <input
                type="radio"
                name={`${uid}-type`}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                checked={vendorType === v}
                onChange={() => setVendorType(v)}
              />
              <span>
                <span className="block font-medium">{t}</span>
                <span className="block text-caption text-ink-soft">{h}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-name`} className="label">
            {vendorType === "company" ? "Business name" : "Name customers know you by"}
          </label>
          <input
            id={`${uid}-name`}
            className="field"
            autoComplete="organization"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...aria("name")}
          />
          {err("name")}
        </div>
        {vendorType === "company" && (
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-legalName`} className="label">
              Registered name <span className="text-ink-soft font-normal">(optional)</span>
            </label>
            <input
              id={`${uid}-legalName`}
              className="field"
              maxLength={160}
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              {...aria("legalName")}
            />
            {err("legalName")}
          </div>
        )}

        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-primaryCategoryId`} className="label">
            What do you mainly do?
          </label>
          <select
            id={`${uid}-primaryCategoryId`}
            className="field"
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            {...aria("primaryCategoryId", true)}
          >
            <option value="">Choose a category</option>
            {tax.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name || c.name}
              </option>
            ))}
          </select>
          <p id={`${uid}-primaryCategoryId-hint`} className="hint">
            You can add more categories in the next step. Event companies: choose Event Management.
          </p>
          {err("primaryCategoryId")}
        </div>

        <div>
          <label htmlFor={`${uid}-districtId`} className="label">
            Home district
          </label>
          <select
            id={`${uid}-districtId`}
            className="field"
            value={districtId}
            onChange={(e) => setDistrictId(e.target.value)}
            {...aria("districtId")}
          >
            <option value="">Choose a district</option>
            {tax.districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {err("districtId")}
        </div>
        <div>
          <label htmlFor={`${uid}-location`} className="label">
            Town <span className="text-ink-soft font-normal">(optional)</span>
          </label>
          <input
            id={`${uid}-location`}
            className="field"
            autoComplete="address-level2"
            maxLength={120}
            placeholder="e.g. Guruvayur"
            value={town}
            onChange={(e) => setTown(e.target.value)}
            {...aria("location")}
          />
          {err("location")}
        </div>

        <div>
          <label htmlFor={`${uid}-phone`} className="label">
            Phone for enquiries
          </label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-control border border-r-0 border-line-strong bg-surface-muted text-sm text-ink-soft">
              +91
            </span>
            <input
              id={`${uid}-phone`}
              className="field !rounded-l-none"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="98470 12345"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              {...aria("phone", true)}
            />
          </div>
          <p id={`${uid}-phone-hint`} className="hint">
            Numbers outside India: start with + and the country code.
          </p>
          {err("phone")}
        </div>
        <div>
          <span className="label" id={`${uid}-wa-label`}>
            WhatsApp
          </span>
          <label className="flex items-center gap-3 min-h-11 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--color-accent)]"
              checked={sameWa}
              onChange={(e) => setSameWa(e.target.checked)}
            />
            Same number as phone
          </label>
          {!sameWa && (
            <>
              <label htmlFor={`${uid}-whatsapp`} className="sr-only">
                WhatsApp number
              </label>
              <input
                id={`${uid}-whatsapp`}
                className="field mt-1"
                type="tel"
                inputMode="tel"
                placeholder="98470 12345"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                {...aria("whatsapp")}
              />
            </>
          )}
          {err("whatsapp")}
        </div>

        <div>
          <label htmlFor={`${uid}-yearsExperience`} className="label">
            Years of experience
          </label>
          <input
            id={`${uid}-yearsExperience`}
            className="field"
            type="number"
            inputMode="numeric"
            min={0}
            max={80}
            value={years}
            onChange={(e) => setYears(e.target.value)}
            {...aria("yearsExperience")}
          />
          {err("yearsExperience")}
        </div>
        {vendorType === "company" ? (
          <div>
            <label htmlFor={`${uid}-yearEstablished`} className="label">
              Year started <span className="text-ink-soft font-normal">(optional)</span>
            </label>
            <input
              id={`${uid}-yearEstablished`}
              className="field"
              type="number"
              inputMode="numeric"
              min={1900}
              max={new Date().getFullYear()}
              value={yearStarted}
              onChange={(e) => setYearStarted(e.target.value)}
              {...aria("yearEstablished")}
            />
            {err("yearEstablished")}
          </div>
        ) : null}
        <div>
          <label htmlFor={`${uid}-teamSize`} className="label">
            Team size <span className="text-ink-soft font-normal">(optional)</span>
          </label>
          <input
            id={`${uid}-teamSize`}
            className="field"
            type="number"
            inputMode="numeric"
            min={1}
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            {...aria("teamSize")}
          />
          {err("teamSize")}
        </div>
      </div>

      <fieldset>
        <legend className="label">Languages you speak with customers</legend>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((lang) => {
            const on = languages.includes(lang);
            return (
              <label
                key={lang}
                className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-control border text-sm cursor-pointer ${
                  on ? "border-accent bg-accent-tint text-accent-hover" : "border-line-strong"
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  checked={on}
                  onChange={(e) => setLanguages(e.target.checked ? [...languages, lang] : languages.filter((x) => x !== lang))}
                />
                {lang}
              </label>
            );
          })}
        </div>
        {err("languages")}
      </fieldset>

      <div>
        <label htmlFor={`${uid}-about`} className="label">
          About your business
        </label>
        <textarea
          id={`${uid}-about`}
          className="field"
          rows={5}
          maxLength={2000}
          placeholder="Who you are, the events you love doing, what customers can expect."
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          {...aria("about", true)}
        />
        <p id={`${uid}-about-hint`} className="hint flex justify-between gap-3">
          <span>At least {ABOUT_MIN} characters. 150+ reads best.</span>
          <span aria-hidden>{about.trim().length}/2000</span>
        </p>
        {err("about")}
      </div>

      <StepActions busy={busy} error={formError} continueLabel={l ? "Save & continue" : "Create my listing"} />
    </form>
  );
}
