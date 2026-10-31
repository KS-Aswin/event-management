// Offering (= services row) validation: price mode/unit/qty rules and
// attribute validation against a template's (or, for "Other" offerings, the
// category's) attribute_schema. PRODUCT_PLAN.md sections 3.2, 3.5 and P0-9.
//
// Pure functions only: no database import, so this file can be unit-tested
// directly with `node --test tests/offering-validation.test.mjs` (Node strips
// the types). Callers load the template/category rules from lib/db.ts
// (findOfferingRules) and pass them in.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Must match services_price_unit_chk in migration 004. */
export const PRICE_UNITS = [
  "event", "package", "day", "hour", "slot", "plate", "person", "artist",
  "item", "set", "kg", "sqft", "km", "vehicle", "session", "piece",
] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** Suffix shown after a price: "₹600 per plate". */
export const PRICE_UNIT_LABELS: Record<PriceUnit, string> = {
  event: "per event",
  package: "per package",
  day: "per day",
  hour: "per hour",
  slot: "per slot",
  plate: "per plate",
  person: "per person",
  artist: "per artist",
  item: "per item",
  set: "per set",
  kg: "per kg",
  sqft: "per sq ft",
  km: "per km",
  vehicle: "per vehicle",
  session: "per session",
  piece: "per piece",
};

export const PRICE_MODES = ["from", "fixed", "range", "on_request"] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const OFFERING_KINDS = ["unit", "package", "addon"] as const;
export type OfferingKind = (typeof OFFERING_KINDS)[number];

/** separate = "Bookable separately"; package_only = only inside packages. */
export const SALE_MODES = ["separate", "package_only"] as const;
export type SaleMode = (typeof SALE_MODES)[number];

export const FULFILMENTS = ["in_house", "partner"] as const;
export type Fulfilment = (typeof FULFILMENTS)[number];

export const ATTRIBUTE_TYPES = ["int", "number", "bool", "text", "enum", "multi", "tags"] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

/** One entry of offering_templates.attribute_schema / categories.attribute_schema. */
export interface AttributeField {
  key: string;
  label: string;
  type: AttributeType;
  /** Allowed values for enum / multi. */
  options?: string[];
  required?: boolean;
  /** int/number: value bounds. text: max length. tags: max items. */
  min?: number;
  max?: number;
  filterable?: boolean;
}

export type AttributeValue = number | boolean | string | string[];

/** The rules an offering is validated against (from its template, or its category for "Other"). */
export interface OfferingRules {
  allowedPriceUnits: readonly string[];
  defaultPriceUnit: string;
  allowOnRequest: boolean;
  attributeSchema: AttributeField[];
}

export const LIMITS = {
  title: 120,
  description: 2000,
  unitLabel: 30,
  inclusion: 120,
  inclusionCount: 30,
  textAttr: 200,
  tagsCount: 20,
  tagLength: 40,
  maxPrice: 100_000_000,
  maxQty: 1_000_000,
} as const;

export type ValidationFailure = { ok: false; field: string; error: string; code: "VALIDATION" };
const fail = (field: string, error: string): ValidationFailure => ({ ok: false, field, error, code: "VALIDATION" });

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

function toStringList(v: unknown): string[] | null {
  if (Array.isArray(v)) {
    if (!v.every((x) => typeof x === "string")) return null;
    return v as string[];
  }
  if (typeof v === "string") return v.split(",");
  return null;
}

/**
 * Validates one attribute value. Returns the cleaned value, `undefined` for
 * "empty" (not stored), or an error message.
 */
export function validateAttributeValue(
  field: AttributeField,
  raw: unknown
): { ok: true; value: AttributeValue | undefined } | { ok: false; error: string } {
  const label = field.label || field.key;
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: undefined };

  switch (field.type) {
    case "int":
    case "number": {
      const n = toNumber(raw);
      if (n === null) return { ok: false, error: `${label} must be a number.` };
      if (field.type === "int" && !Number.isInteger(n)) return { ok: false, error: `${label} must be a whole number.` };
      if (field.min !== undefined && n < field.min) return { ok: false, error: `${label} must be at least ${field.min}.` };
      if (field.max !== undefined && n > field.max) return { ok: false, error: `${label} must be at most ${field.max}.` };
      return { ok: true, value: n };
    }
    case "bool": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "on" || raw === "1" || raw === 1) return { ok: true, value: true };
      if (raw === "false" || raw === "off" || raw === "0" || raw === 0) return { ok: true, value: false };
      return { ok: false, error: `${label} must be yes or no.` };
    }
    case "text": {
      if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, error: `${label} must be text.` };
      const s = String(raw).trim().replace(/\s+/g, " ");
      if (!s) return { ok: true, value: undefined };
      const max = field.max ?? LIMITS.textAttr;
      if (s.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
      return { ok: true, value: s };
    }
    case "enum": {
      if (typeof raw !== "string" || !(field.options ?? []).includes(raw)) {
        return { ok: false, error: `${label} must be one of: ${(field.options ?? []).join(", ")}.` };
      }
      return { ok: true, value: raw };
    }
    case "multi": {
      const list = toStringList(raw);
      if (!list) return { ok: false, error: `${label} must be a list.` };
      const opts = field.options ?? [];
      const cleaned = [...new Set(list.map((x) => x.trim()).filter(Boolean))];
      const bad = cleaned.find((x) => !opts.includes(x));
      if (bad !== undefined) return { ok: false, error: `${label}: "${bad}" is not one of: ${opts.join(", ")}.` };
      return { ok: true, value: cleaned.length ? cleaned : undefined };
    }
    case "tags": {
      const list = toStringList(raw);
      if (!list) return { ok: false, error: `${label} must be a list.` };
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const t of list) {
        const s = t.trim().replace(/\s+/g, " ");
        if (!s) continue;
        if (s.length > LIMITS.tagLength) return { ok: false, error: `Each ${label} entry must be ${LIMITS.tagLength} characters or fewer.` };
        const k = s.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          cleaned.push(s);
        }
      }
      const max = field.max ?? LIMITS.tagsCount;
      if (cleaned.length > max) return { ok: false, error: `${label} can have at most ${max} entries.` };
      return { ok: true, value: cleaned.length ? cleaned : undefined };
    }
    default:
      return { ok: false, error: `${label} has an unsupported type.` };
  }
}

/**
 * Validates an attributes object against a schema. Unknown keys are stripped
 * (never stored). A missing required field fails with that field's key, as
 * `attributes.<key>`. With `partial`, required fields are only checked when
 * present (for PATCH bodies that send a subset).
 */
export function validateAttributes(
  schema: readonly AttributeField[],
  input: unknown,
  opts: { partial?: boolean } = {}
): { ok: true; attributes: Record<string, AttributeValue> } | ValidationFailure {
  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input))) {
    return fail("attributes", "Attributes must be an object.");
  }
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: Record<string, AttributeValue> = {};
  for (const field of schema) {
    const has = Object.prototype.hasOwnProperty.call(raw, field.key);
    const r = validateAttributeValue(field, has ? raw[field.key] : undefined);
    if (!r.ok) return fail(`attributes.${field.key}`, r.error);
    if (r.value === undefined) {
      if (field.required && (!opts.partial || has)) {
        return fail(`attributes.${field.key}`, `${field.label || field.key} is required.`);
      }
      continue;
    }
    out[field.key] = r.value;
  }
  return { ok: true, attributes: out };
}

/** Parses a JSONB attribute_schema value defensively (bad entries are dropped). */
export function parseAttributeSchema(value: unknown): AttributeField[] {
  if (!Array.isArray(value)) return [];
  const out: AttributeField[] = [];
  for (const f of value) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    if (typeof o.key !== "string" || !/^[a-z][a-z0-9_]{0,40}$/.test(o.key)) continue;
    if (typeof o.type !== "string" || !(ATTRIBUTE_TYPES as readonly string[]).includes(o.type)) continue;
    out.push({
      key: o.key,
      label: typeof o.label === "string" ? o.label : o.key,
      type: o.type as AttributeType,
      options: Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === "string") : undefined,
      required: o.required === true,
      min: typeof o.min === "number" ? o.min : undefined,
      max: typeof o.max === "number" ? o.max : undefined,
      filterable: o.filterable === true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Offering body
// ---------------------------------------------------------------------------

export interface ParsedOfferingFields {
  kind?: OfferingKind;
  templateId?: number | null;
  /** "Other": the vendor's own name (contact details masked). */
  customName?: string | null;
  /** True when a phone number / URL / email was masked out of customName or description. */
  flaggedContact?: boolean;
  categoryId?: number;
  title?: string;
  description?: string;
  saleMode?: SaleMode;
  fulfilment?: Fulfilment;
  parentServiceId?: number | null;
  priceMode?: PriceMode;
  priceFrom?: number;
  priceTo?: number | null;
  priceUnit?: PriceUnit;
  unitLabel?: string | null;
  minQty?: number | null;
  maxQty?: number | null;
  qtyStep?: number;
  qtyOwned?: number | null;
  guestMin?: number | null;
  guestMax?: number | null;
  leadTimeDays?: number | null;
  inclusions?: string[];
  attributes?: Record<string, AttributeValue>;
  eventTypeIds?: number[];
  active?: boolean;
}

function optInt(v: unknown, min: number, max: number): number | null | undefined | "bad" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = toNumber(v);
  if (n === null || !Number.isInteger(n) || n < min || n > max) return "bad";
  return n;
}

function optQty(v: unknown): number | null | undefined | "bad" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = toNumber(v);
  if (n === null || n <= 0 || n > LIMITS.maxQty) return "bad";
  // NUMERIC(10,2): two decimals.
  if (Math.round(n * 100) !== n * 100) return "bad";
  return n;
}

function optId(v: unknown): number | null | undefined | "bad" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = toNumber(v);
  if (n === null || !Number.isInteger(n) || n < 1 || n > 2147483647) return "bad";
  return n;
}

/**
 * Validates an offering create (requireAll) or update body.
 *
 * `rules` are the template's rules (or the category's for a custom/"Other"
 * offering, or package rules from packageRules()). When given, the price unit
 * must be in allowedPriceUnits, on_request needs allowOnRequest, and
 * attributes are validated against attributeSchema (unknown keys stripped).
 *
 * `existing` is the stored row on update, so cross-field rules (range needs
 * price_to >= price_from, guest/qty ranges) are checked against the merged
 * result.
 */
export function parseOfferingBody(
  body: unknown,
  opts: {
    requireAll: boolean;
    rules?: OfferingRules;
    existing?: {
      kind?: OfferingKind;
      price_mode?: string;
      price_from?: number;
      price_to?: number | null;
      price_unit?: string;
      min_qty?: number | string | null;
      max_qty?: number | string | null;
      guest_min?: number | null;
      guest_max?: number | null;
      sale_mode?: string;
    };
  }
): { ok: true; fields: ParsedOfferingFields } | ValidationFailure {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body", "Invalid request body.");
  const raw = body as Record<string, unknown>;
  const f: ParsedOfferingFields = {};
  const { requireAll, rules, existing } = opts;

  // kind
  if (raw.kind !== undefined) {
    if (typeof raw.kind !== "string" || !(OFFERING_KINDS as readonly string[]).includes(raw.kind)) {
      return fail("kind", "Kind must be unit, package or addon.");
    }
    f.kind = raw.kind as OfferingKind;
  }
  const kind: OfferingKind = f.kind ?? existing?.kind ?? "unit";

  // template / custom name
  const tid = optId(raw.templateId);
  if (tid === "bad") return fail("templateId", "Please choose a valid offering.");
  if (tid !== undefined) f.templateId = tid;

  if (raw.customName !== undefined && raw.customName !== null && raw.customName !== "") {
    if (typeof raw.customName !== "string") return fail("customName", "Please enter a name for your offering.");
    const name = raw.customName.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > LIMITS.title) {
      return fail("customName", `The name must be 2 to ${LIMITS.title} characters.`);
    }
    const masked = maskContactDetails(name);
    f.customName = masked.text;
    if (masked.flagged) f.flaggedContact = true;
  } else if (raw.customName === null || raw.customName === "") {
    f.customName = null;
  }

  const cid = optId(raw.categoryId);
  if (cid === "bad" || cid === null) return fail("categoryId", "Please choose a category.");
  if (cid !== undefined) f.categoryId = cid;

  // title: falls back to the custom name.
  if (raw.title !== undefined) {
    if (typeof raw.title !== "string") return fail("title", `Name must be 2 to ${LIMITS.title} characters.`);
    const t = raw.title.trim().replace(/\s+/g, " ");
    if (t.length < 2 || t.length > LIMITS.title) return fail("title", `Name must be 2 to ${LIMITS.title} characters.`);
    const masked = maskContactDetails(t);
    f.title = masked.text;
    if (masked.flagged) f.flaggedContact = true;
  } else if (f.customName) {
    f.title = f.customName;
  }
  if (requireAll && kind !== "package" && f.templateId == null && !f.customName && !f.title) {
    return fail("templateId", "Please choose an offering or pick Other and type a name.");
  }
  if (requireAll && kind === "package" && !f.title) {
    return fail("title", `Package name must be 2 to ${LIMITS.title} characters.`);
  }

  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== "string" || raw.description.length > LIMITS.description) {
      return fail("description", `Description must be ${LIMITS.description} characters or fewer.`);
    }
    const masked = maskContactDetails(raw.description.trim());
    f.description = masked.text;
    if (masked.flagged) f.flaggedContact = true;
  }

  // sale mode / fulfilment / parent
  if (raw.saleMode !== undefined) {
    if (typeof raw.saleMode !== "string" || !(SALE_MODES as readonly string[]).includes(raw.saleMode)) {
      return fail("saleMode", "Choose Bookable separately or Package only.");
    }
    f.saleMode = raw.saleMode as SaleMode;
  }
  if (kind === "package" && (f.saleMode ?? existing?.sale_mode) === "package_only") {
    return fail("saleMode", "A package is always bookable on its own.");
  }
  if (raw.fulfilment !== undefined) {
    if (typeof raw.fulfilment !== "string" || !(FULFILMENTS as readonly string[]).includes(raw.fulfilment)) {
      return fail("fulfilment", "Choose In-house or Partner.");
    }
    f.fulfilment = raw.fulfilment as Fulfilment;
  }
  const pid = optId(raw.parentServiceId);
  if (pid === "bad") return fail("parentServiceId", "Please choose the offering this add-on belongs to.");
  if (pid !== undefined) f.parentServiceId = pid;
  if (kind === "addon" && requireAll && !f.parentServiceId) {
    return fail("parentServiceId", "Please choose the offering this add-on belongs to.");
  }
  if (kind !== "addon" && f.parentServiceId) {
    return fail("parentServiceId", "Only add-ons can be attached to another offering.");
  }

  // price mode
  if (raw.priceMode !== undefined) {
    if (typeof raw.priceMode !== "string" || !(PRICE_MODES as readonly string[]).includes(raw.priceMode)) {
      return fail("priceMode", "Price type must be Starting from, Fixed, Range or On request.");
    }
    f.priceMode = raw.priceMode as PriceMode;
  }
  const priceMode = (f.priceMode ?? existing?.price_mode ?? "from") as PriceMode;
  if (priceMode === "on_request" && rules && !rules.allowOnRequest && (f.priceMode !== undefined || requireAll)) {
    return fail("priceMode", "Price on request isn't available for this offering. Please enter a price.");
  }

  // prices (integer rupees)
  if (raw.priceFrom !== undefined && raw.priceFrom !== null && raw.priceFrom !== "") {
    const n = toNumber(raw.priceFrom);
    if (n === null || !Number.isInteger(n) || n < 0 || n > LIMITS.maxPrice) {
      return fail("priceFrom", "Please enter a valid price in rupees.");
    }
    f.priceFrom = n;
  } else if (priceMode === "on_request") {
    if (requireAll || f.priceMode !== undefined) f.priceFrom = 0;
  } else if (requireAll) {
    return fail("priceFrom", "Please enter a price.");
  }
  if (priceMode !== "on_request" && f.priceFrom === 0) {
    return fail(
      "priceFrom",
      rules?.allowOnRequest ? "Please enter a price above ₹0, or choose Price on request." : "Please enter a price above ₹0."
    );
  }

  if (raw.priceTo !== undefined) {
    if (raw.priceTo === null || raw.priceTo === "") f.priceTo = null;
    else {
      const n = toNumber(raw.priceTo);
      if (n === null || !Number.isInteger(n) || n < 0 || n > LIMITS.maxPrice) {
        return fail("priceTo", "Please enter a valid upper price.");
      }
      f.priceTo = n;
    }
  }
  if (priceMode === "range") {
    const from = f.priceFrom ?? existing?.price_from;
    const to = f.priceTo !== undefined ? f.priceTo : existing?.price_to;
    if (to == null) return fail("priceTo", "Please enter the upper price for the range.");
    if (from !== undefined && to < from) return fail("priceTo", "The upper price must be at least the starting price.");
  } else if (f.priceMode !== undefined && f.priceTo === undefined) {
    // Leaving range mode clears the stored upper price.
    f.priceTo = null;
  }

  // price unit
  if (raw.priceUnit !== undefined) {
    if (typeof raw.priceUnit !== "string" || !(PRICE_UNITS as readonly string[]).includes(raw.priceUnit)) {
      return fail("priceUnit", "Please choose a valid price unit.");
    }
    if (rules && !rules.allowedPriceUnits.includes(raw.priceUnit)) {
      return fail(
        "priceUnit",
        `This offering can be priced ${rules.allowedPriceUnits.map((u) => PRICE_UNIT_LABELS[u as PriceUnit] ?? u).join(", ")}.`
      );
    }
    f.priceUnit = raw.priceUnit as PriceUnit;
  } else if (requireAll && rules) {
    f.priceUnit = rules.defaultPriceUnit as PriceUnit;
  }

  if (raw.unitLabel !== undefined) {
    if (raw.unitLabel === null || raw.unitLabel === "") f.unitLabel = null;
    else if (typeof raw.unitLabel !== "string" || raw.unitLabel.trim().length > LIMITS.unitLabel) {
      return fail("unitLabel", `Unit label must be ${LIMITS.unitLabel} characters or fewer.`);
    } else f.unitLabel = raw.unitLabel.trim();
  }

  // quantities
  for (const [key, out] of [["minQty", "minQty"], ["maxQty", "maxQty"]] as const) {
    const q = optQty(raw[key]);
    if (q === "bad") return fail(key, "Please enter a quantity above 0 (up to 2 decimals).");
    if (q !== undefined) f[out] = q;
  }
  if (raw.qtyStep !== undefined && raw.qtyStep !== null && raw.qtyStep !== "") {
    const q = optQty(raw.qtyStep);
    if (q === "bad" || q === null || q === undefined) return fail("qtyStep", "Step must be above 0, e.g. 0.5 or 1.");
    f.qtyStep = q;
  }
  {
    const min = f.minQty !== undefined ? f.minQty : existing?.min_qty != null ? Number(existing.min_qty) : null;
    const max = f.maxQty !== undefined ? f.maxQty : existing?.max_qty != null ? Number(existing.max_qty) : null;
    if (min != null && max != null && max < min) return fail("maxQty", "Maximum quantity must be at least the minimum.");
  }
  const owned = optInt(raw.qtyOwned, 0, LIMITS.maxQty);
  if (owned === "bad") return fail("qtyOwned", "Quantity owned must be a whole number.");
  if (owned !== undefined) f.qtyOwned = owned;

  const gmin = optInt(raw.guestMin, 1, 100000);
  if (gmin === "bad") return fail("guestMin", "Minimum guests must be between 1 and 100,000.");
  if (gmin !== undefined) f.guestMin = gmin;
  const gmax = optInt(raw.guestMax, 1, 100000);
  if (gmax === "bad") return fail("guestMax", "Maximum guests must be between 1 and 100,000.");
  if (gmax !== undefined) f.guestMax = gmax;
  {
    const min = f.guestMin !== undefined ? f.guestMin : existing?.guest_min ?? null;
    const max = f.guestMax !== undefined ? f.guestMax : existing?.guest_max ?? null;
    if (min != null && max != null && max < min) return fail("guestMax", "Maximum guests must be at least the minimum.");
  }

  const lead = optInt(raw.leadTimeDays, 0, 365);
  if (lead === "bad") return fail("leadTimeDays", "Lead time must be 0 to 365 days.");
  if (lead !== undefined) f.leadTimeDays = lead;

  if (raw.inclusions !== undefined) {
    const list = raw.inclusions === null ? [] : toStringList(raw.inclusions);
    if (!list) return fail("inclusions", "Inclusions must be a list.");
    const cleaned = list.map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    if (cleaned.length > LIMITS.inclusionCount) return fail("inclusions", `At most ${LIMITS.inclusionCount} inclusions.`);
    if (cleaned.some((s) => s.length > LIMITS.inclusion)) {
      return fail("inclusions", `Each inclusion must be ${LIMITS.inclusion} characters or fewer.`);
    }
    f.inclusions = cleaned.map((s) => maskContactDetails(s).text);
  }

  if (raw.eventTypeIds !== undefined) {
    if (!Array.isArray(raw.eventTypeIds)) return fail("eventTypeIds", "Event types must be a list.");
    const ids: number[] = [];
    for (const v of raw.eventTypeIds) {
      const id = optId(v);
      if (id === "bad" || id == null) return fail("eventTypeIds", "Please choose valid event types.");
      if (!ids.includes(id)) ids.push(id);
    }
    f.eventTypeIds = ids;
  }

  if (raw.active !== undefined) {
    if (typeof raw.active !== "boolean") return fail("active", "Active must be true or false.");
    f.active = raw.active;
  }

  // attributes
  if (raw.attributes !== undefined || (requireAll && rules)) {
    const schema = rules?.attributeSchema ?? [];
    const r = validateAttributes(schema, raw.attributes, { partial: !requireAll });
    if (!r.ok) return r;
    f.attributes = r.attributes;
  }

  return { ok: true, fields: f };
}

/** Rules for a package (kind='package'): any unit, on request always allowed, no attributes. */
export function packageRules(): OfferingRules {
  return {
    allowedPriceUnits: ["package", "event", "day", "person", "plate"],
    defaultPriceUnit: "package",
    allowOnRequest: true,
    attributeSchema: [],
  };
}

/** Validates package items `[{serviceId, qty?, note?}]` (ownership is checked in the DB). */
export function parsePackageItems(
  raw: unknown
): { ok: true; items: { serviceId: number; qty: number; note: string }[] } | ValidationFailure {
  if (!Array.isArray(raw)) return fail("items", "Add at least one offering to the package.");
  if (raw.length === 0) return fail("items", "Add at least one offering to the package.");
  if (raw.length > 50) return fail("items", "A package can have at most 50 items.");
  const items: { serviceId: number; qty: number; note: string }[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") return fail("items", "Invalid package item.");
    const o = it as Record<string, unknown>;
    const id = optId(o.serviceId);
    if (id === "bad" || id == null) return fail("items", "Invalid package item.");
    if (items.some((x) => x.serviceId === id)) return fail("items", "Each offering can be added to a package once.");
    const q = o.qty === undefined ? 1 : optQty(o.qty);
    if (q === "bad" || q == null) return fail("items", "Item quantity must be above 0.");
    const note = typeof o.note === "string" ? o.note.trim().slice(0, 200) : "";
    items.push({ serviceId: id, qty: q, note: maskContactDetails(note).text });
  }
  return { ok: true, items };
}

// ---------------------------------------------------------------------------
// Custom names, contact masking, price labels
// ---------------------------------------------------------------------------

const CONTACT_PATTERNS: RegExp[] = [
  // phone numbers: 10+ digits with optional separators / +91
  /(?:\+?\d[\s\-().]*){10,}/g,
  // emails
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  // URLs and bare domains
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b[a-z0-9-]+\.(?:com|in|net|org|co|io|me|info|biz)\b(?:\/\S*)?/gi,
];

/** Masks phone numbers, emails and URLs (anti-bypass, spec section 5). */
export function maskContactDetails(text: string): { text: string; flagged: boolean } {
  let out = text;
  let flagged = false;
  for (const re of CONTACT_PATTERNS) {
    out = out.replace(re, () => {
      flagged = true;
      return "•••";
    });
  }
  return { text: out, flagged };
}

export function containsContactDetails(text: string): boolean {
  return maskContactDetails(text).flagged;
}

const CUSTOM_NAME_SUFFIXES = ["team", "service", "services", "group", "troupe", "artists", "artist", "crew", "co"];

/**
 * custom_offering_requests.normalised_name: lower-case, punctuation and
 * spaces collapsed, common suffixes ("team", "service") stripped.
 * "Kolkali  Team!" -> "kolkali".
 */
export function normaliseCustomName(raw: string): string {
  const words = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  while (words.length > 1 && CUSTOM_NAME_SUFFIXES.includes(words[words.length - 1])) words.pop();
  return words.join(" ");
}

function rupees(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

/** "Starting from ₹45,000 per event", "₹600 per leaf", "₹20,000 – ₹35,000 per day", "Price on request". */
export function formatOfferingPrice(o: {
  price_mode: string;
  price_from: number;
  price_to?: number | null;
  price_unit: string;
  unit_label?: string | null;
}): string {
  if (o.price_mode === "on_request") return "Price on request";
  const unit = o.unit_label ? `per ${o.unit_label}` : PRICE_UNIT_LABELS[o.price_unit as PriceUnit] ?? "";
  const suffix = unit ? ` ${unit}` : "";
  if (o.price_mode === "range" && o.price_to != null) return `${rupees(o.price_from)} – ${rupees(o.price_to)}${suffix}`;
  if (o.price_mode === "fixed") return `${rupees(o.price_from)}${suffix}`;
  return `Starting from ${rupees(o.price_from)}${suffix}`;
}

/** vendors.price_label cache: "₹45,000 onwards", "₹600 per plate", or "Price on request". */
export function formatVendorPriceLabel(
  o: { price_from: number; price_unit: string; unit_label?: string | null } | null
): string {
  if (!o) return "Price on request";
  if (o.price_unit === "event" || o.price_unit === "package") return `${rupees(o.price_from)} onwards`;
  const unit = o.unit_label ? `per ${o.unit_label}` : PRICE_UNIT_LABELS[o.price_unit as PriceUnit] ?? "";
  return `${rupees(o.price_from)} ${unit}`.trim();
}

// ---------------------------------------------------------------------------
// Legacy service body (kept for /api/vendors/[id]/services and /api/services/[id]
// until P0-14 removes them; lib/service-validation.ts re-exports this).
// ---------------------------------------------------------------------------

/** Price units the legacy dashboard form offers (matches SERVICE_PRICE_UNITS in lib/db.ts). */
export const LEGACY_SERVICE_PRICE_UNITS = ["event", "day", "hour", "plate", "person", "package"] as const;

export interface ParsedServiceFields {
  category?: string;
  title?: string;
  description?: string;
  priceFrom?: number;
  priceUnit?: string;
  active?: boolean;
}

// Validates a service create/update body. When `requireAll` is true (create),
// category, title and priceFrom must be present. Returns either the cleaned
// fields or an error message suitable for a 400 response.
export function parseServiceBody(
  body: unknown,
  requireAll: boolean
): { ok: true; fields: ParsedServiceFields } | { ok: false; error: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const fields: ParsedServiceFields = {};

  if (raw.category !== undefined) {
    if (typeof raw.category !== "string" || !raw.category.trim()) {
      return { ok: false, error: "Please choose a category." };
    }
    fields.category = raw.category.trim();
  } else if (requireAll) {
    return { ok: false, error: "Please choose a category." };
  }

  if (raw.title !== undefined) {
    if (typeof raw.title !== "string" || raw.title.trim().length < 2 || raw.title.trim().length > 120) {
      return { ok: false, error: "Service name must be 2 to 120 characters." };
    }
    fields.title = raw.title.trim();
  } else if (requireAll) {
    return { ok: false, error: "Service name must be 2 to 120 characters." };
  }

  if (raw.description !== undefined) {
    if (typeof raw.description !== "string" || raw.description.length > 1000) {
      return { ok: false, error: "Description must be 1000 characters or fewer." };
    }
    fields.description = raw.description.trim();
  }

  if (raw.priceFrom !== undefined) {
    const n = typeof raw.priceFrom === "number" ? raw.priceFrom : parseInt(String(raw.priceFrom), 10);
    if (!Number.isInteger(n) || n < 0 || n > 100000000) {
      return { ok: false, error: "Please enter a valid starting price." };
    }
    fields.priceFrom = n;
  } else if (requireAll) {
    return { ok: false, error: "Please enter a valid starting price." };
  }

  if (raw.priceUnit !== undefined) {
    if (
      typeof raw.priceUnit !== "string" ||
      !(LEGACY_SERVICE_PRICE_UNITS as readonly string[]).includes(raw.priceUnit)
    ) {
      return { ok: false, error: `Price unit must be one of: ${LEGACY_SERVICE_PRICE_UNITS.join(", ")}.` };
    }
    fields.priceUnit = raw.priceUnit;
  }

  if (raw.active !== undefined) {
    if (typeof raw.active !== "boolean") {
      return { ok: false, error: "Active must be true or false." };
    }
    fields.active = raw.active;
  }

  return { ok: true, fields };
}
