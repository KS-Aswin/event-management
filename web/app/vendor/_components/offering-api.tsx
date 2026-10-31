// Shared client types and fetch helpers for the onboarding wizard and the
// offerings manager. Rows come from /api/vendor/offerings (snake_case, as
// stored) plus price_label / needs_price.

export interface AttributeFieldLite {
  key: string;
  label: string;
  type: "int" | "number" | "bool" | "text" | "enum" | "multi" | "tags";
  options?: string[];
  required?: boolean;
  unit?: string;
  min?: number;
  max?: number;
}

export interface CategoryLite {
  id: number;
  name: string;
  slug: string;
  display_name: string;
  allowed_price_units: string[];
  default_price_unit: string;
  allow_on_request: boolean;
  attribute_schema: AttributeFieldLite[];
}

export interface TemplateLite {
  id: number;
  category_id: number;
  code: string;
  name: string;
  kind: "unit" | "addon";
  default_price_unit: string;
  allowed_price_units: string[];
  allow_on_request: boolean;
  attribute_schema: AttributeFieldLite[];
  is_core: boolean;
}

export interface TaxonomyLite {
  categories: CategoryLite[];
  templates: TemplateLite[];
  eventTypes: { id: number; name: string }[];
  districts: { id: number; name: string }[];
  priceUnits: { value: string; label: string }[];
}

export interface Offering {
  id: number;
  category_id: number;
  category: string;
  category_slug: string;
  template_id: number | null;
  template_name: string | null;
  custom_name: string | null;
  kind: "unit" | "package" | "addon";
  title: string;
  description: string;
  sale_mode: "separate" | "package_only";
  fulfilment: "in_house" | "partner";
  parent_service_id: number | null;
  price_mode: "from" | "fixed" | "range" | "on_request";
  price_from: number;
  price_to: number | null;
  price_unit: string;
  unit_label: string | null;
  min_qty: string | null;
  max_qty: string | null;
  guest_min: number | null;
  guest_max: number | null;
  lead_time_days: number | null;
  inclusions: string[];
  attributes: Record<string, unknown>;
  incomplete: boolean;
  hidden_reason: string | null;
  active: boolean;
  sort_order: number;
  event_type_ids: number[];
  price_label: string;
  needs_price: boolean;
}

export interface PackageItem {
  package_id: number;
  item_id: number;
  qty: string;
  note: string;
  title: string;
  active: boolean;
  sale_mode: string;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; field?: string; code?: string; data: Record<string, unknown> };

/** JSON fetch that never throws: network errors come back as ok:false. */
export async function api<T = Record<string, unknown>>(url: string, method = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    let data: Record<string, unknown> = {};
    try {
      data = await res.json();
    } catch {
      // empty body
    }
    if (res.ok) return { ok: true, status: res.status, data: data as T };
    const error =
      typeof data.error === "string"
        ? data.error
        : res.status === 401
          ? "Your session has ended. Please sign in again."
          : "Something went wrong. Please try again.";
    return {
      ok: false,
      status: res.status,
      error,
      field: typeof data.field === "string" ? data.field : undefined,
      code: typeof data.code === "string" ? data.code : undefined,
      data,
    };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server. Check your connection and try again.", data: {} };
  }
}

export const PRICE_MODE_LABELS: Record<Offering["price_mode"], string> = {
  from: "Starting from",
  fixed: "Fixed price",
  range: "Price range",
  on_request: "On request",
};

/** "per plate" -> "Per plate" for select options. */
export function unitOptionLabel(tax: TaxonomyLite, unit: string): string {
  const l = tax.priceUnits.find((u) => u.value === unit)?.label ?? unit;
  return l.charAt(0).toUpperCase() + l.slice(1);
}

/** Price rules for an offering: its template's, else its category's. */
export function rulesFor(tax: TaxonomyLite, o: { template_id: number | null; category_id: number; kind?: string }) {
  if (o.kind === "package") {
    return {
      allowedPriceUnits: ["package", "event", "day", "person", "plate"],
      defaultPriceUnit: "package",
      allowOnRequest: true,
      schema: [] as AttributeFieldLite[],
    };
  }
  const t = o.template_id ? tax.templates.find((x) => x.id === o.template_id) : undefined;
  const c = tax.categories.find((x) => x.id === o.category_id);
  if (t) {
    return {
      allowedPriceUnits: t.allowed_price_units,
      defaultPriceUnit: t.default_price_unit,
      allowOnRequest: t.allow_on_request,
      schema: t.attribute_schema,
    };
  }
  return {
    allowedPriceUnits: c?.allowed_price_units ?? ["event"],
    defaultPriceUnit: c?.default_price_unit ?? "event",
    allowOnRequest: c?.allow_on_request ?? false,
    schema: c?.attribute_schema ?? [],
  };
}

export function categoryName(tax: TaxonomyLite, id: number | null | undefined): string {
  const c = tax.categories.find((x) => x.id === id);
  return c?.display_name || c?.name || "Other";
}

/** Status chips shown on an offering row. */
export function offeringChips(o: Offering): { label: string; tone: "neutral" | "accent" | "warn" | "muted" }[] {
  const chips: { label: string; tone: "neutral" | "accent" | "warn" | "muted" }[] = [];
  if (o.kind === "addon") chips.push({ label: "Add-on", tone: "neutral" });
  else if (o.kind === "unit") {
    chips.push(
      o.sale_mode === "separate"
        ? { label: "Bookable separately", tone: "accent" }
        : { label: "Package only", tone: "neutral" }
    );
  }
  if (o.fulfilment === "partner") chips.push({ label: "Via partner", tone: "neutral" });
  if (!o.template_id && o.kind !== "package") chips.push({ label: "Custom: under review", tone: "muted" });
  if (o.kind === "package" && o.incomplete) chips.push({ label: "Incomplete package", tone: "warn" });
  if (o.needs_price) chips.push({ label: "Needs a price", tone: "warn" });
  else if (!o.active) chips.push({ label: "Off", tone: "muted" });
  if (o.hidden_reason) chips.push({ label: "Hidden", tone: "warn" });
  return chips;
}

export function Chip({ label, tone }: { label: string; tone: "neutral" | "accent" | "warn" | "muted" }) {
  const cls =
    tone === "accent"
      ? "bg-accent-tint text-accent-hover"
      : tone === "warn"
        ? "bg-[#fdf3d8] text-gold-ink"
        : tone === "muted"
          ? "bg-surface-muted text-ink-soft"
          : "bg-surface-muted text-[#3c4043]";
  return <span className={`chip ${cls}`}>{label}</span>;
}
