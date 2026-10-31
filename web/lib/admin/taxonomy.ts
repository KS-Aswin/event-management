// Admin taxonomy manager (P1-7) and custom "Other" offering queue (P1-8).
// PRODUCT_PLAN.md sections 3.5, 6 "Admin", 7 "Admin", 8 P1-7/P1-8.
//
// Every mutation runs in ONE withTransaction() with exactly one audit() row.
// Route handlers call invalidateTaxonomy() after a successful commit so new or
// changed categories/templates/event types reach /api/meta/taxonomy (vendor
// onboarding, offering picker, search filters) without a deploy.

import { revalidateTag } from "next/cache";
import { pool, recomputeVendorPrice } from "@/lib/db";
import { TAXONOMY_TAG } from "@/lib/taxonomy";
import {
  ATTRIBUTE_TYPES,
  PRICE_UNITS,
  normaliseCustomName,
  parseAttributeSchema,
  type AttributeField,
  type AttributeType,
} from "@/lib/offering-validation";
import { audit } from "./audit";
import { notify } from "./notify";
import { HttpError, withTransaction, type TxClient } from "./tx";

/** Expire the cached taxonomy immediately (next read is a cache miss). */
export function invalidateTaxonomy(): void {
  try {
    revalidateTag(TAXONOMY_TAG, { expire: 0 });
  } catch (err) {
    // Outside a request scope (scripts/tests) there is no cache to expire.
    console.warn("invalidateTaxonomy: revalidateTag failed", err);
  }
}

/** "12" -> 12; anything that isn't a positive int4 -> null. */
export function parseRouteId(s: string): number | null {
  return /^[1-9][0-9]{0,9}$/.test(s) && Number(s) <= 2 ** 31 - 1 ? Number(s) : null;
}

export interface Actor {
  actorId: number;
  ip?: string | null;
}

// ---------------------------------------------------------------------------
// Validation helpers (throw HttpError 400 with a message for the form)
// ---------------------------------------------------------------------------

function bad(message: string, code = "INVALID"): never {
  throw new HttpError(400, message, code);
}

function str(v: unknown, field: string, { min = 1, max = 80 } = {}): string {
  if (typeof v !== "string") bad(`${field} is required.`);
  const s = v.trim().replace(/\s+/g, " ");
  if (s.length < min) bad(`${field} is required.`);
  if (s.length > max) bad(`${field} must be ${max} characters or fewer.`);
  return s;
}

function optStr(v: unknown, field: string, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") bad(`${field} must be text.`);
  const s = v.trim();
  if (s.length > max) bad(`${field} must be ${max} characters or fewer.`);
  return s || null;
}

function optBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") bad(`${field} must be true or false.`);
  return v;
}

function optInt(v: unknown, field: string, min = 0, max = 100000): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) bad(`${field} must be a whole number.`);
  return v;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function slugField(v: unknown, field: string): string {
  if (typeof v !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) || v.length > 60) {
    bad(`${field} may use lower-case letters, numbers and dashes only.`);
  }
  return v;
}

function iconField(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^[a-z0-9-]{1,30}$/.test(v)) bad("Icon must be a short name like camera or flower.");
  return v;
}

/** Validates allowed units (subset of PRICE_UNITS, 1..8) and the default (must be in the set). */
function priceUnits(
  unitsIn: unknown,
  defIn: unknown,
  fallback?: { units: string[]; def: string }
): { units: string[]; def: string } | undefined {
  if (unitsIn === undefined && defIn === undefined) return undefined;
  let units = fallback?.units ?? [];
  if (unitsIn !== undefined) {
    if (!Array.isArray(unitsIn) || unitsIn.length === 0) bad("Pick at least one price unit.");
    const set = [...new Set(unitsIn)];
    for (const u of set) {
      if (typeof u !== "string" || !(PRICE_UNITS as readonly string[]).includes(u)) bad(`Unknown price unit: ${String(u)}.`);
    }
    if (set.length > 8) bad("Pick at most 8 price units.");
    units = set as string[];
  }
  let def = typeof defIn === "string" ? defIn : fallback?.def ?? units[0];
  if (!units.includes(def)) {
    if (defIn !== undefined) bad("The default price unit must be one of the allowed units.");
    def = units[0];
  }
  return { units, def };
}

const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

/** Validates an attribute schema from the schema builder; throws 400 on the first problem. */
export function validateAttributeSchema(v: unknown): AttributeField[] {
  if (!Array.isArray(v)) bad("Attributes must be a list.");
  if (v.length > 30) bad("A template can have at most 30 attributes.");
  const seen = new Set<string>();
  return v.map((raw, i) => {
    const row = `Attribute ${i + 1}`;
    if (!raw || typeof raw !== "object") bad(`${row} is invalid.`);
    const o = raw as Record<string, unknown>;
    if (typeof o.key !== "string" || !KEY_RE.test(o.key)) {
      bad(`${row}: key must start with a letter and use lower-case letters, numbers and _ only.`, "BAD_KEY");
    }
    if (seen.has(o.key)) bad(`${row}: key "${o.key}" is used twice.`, "DUPLICATE_KEY");
    seen.add(o.key);
    const label = str(o.label, `${row} label`, { max: 80 });
    if (typeof o.type !== "string" || !(ATTRIBUTE_TYPES as readonly string[]).includes(o.type)) bad(`${row}: pick a type.`);
    const type = o.type as AttributeType;
    const field: AttributeField = { key: o.key, label, type };
    if (type === "enum" || type === "multi") {
      if (!Array.isArray(o.options)) bad(`${row}: add at least one option.`);
      const opts = [...new Set(o.options.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
      if (opts.length === 0) bad(`${row}: add at least one option.`);
      if (opts.length > 60 || opts.some((x) => x.length > 60)) bad(`${row}: too many or too long options.`);
      field.options = opts;
    }
    if (o.required === true) field.required = true;
    if (o.filterable === true) field.filterable = true;
    for (const k of ["min", "max"] as const) {
      if (o[k] !== undefined && o[k] !== null && o[k] !== "") {
        if (typeof o[k] !== "number" || !Number.isFinite(o[k])) bad(`${row}: ${k} must be a number.`);
        field[k] = o[k] as number;
      }
    }
    if (field.min !== undefined && field.max !== undefined && field.max < field.min) bad(`${row}: max is below min.`);
    return field;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AdminCategory {
  id: number;
  name: string;
  slug: string;
  display_name: string;
  icon: string | null;
  description: string;
  active: boolean;
  sort_order: number;
  default_price_unit: string;
  allowed_price_units: string[];
  allow_on_request: boolean;
  attribute_schema: AttributeField[];
  active_offerings: number;
  template_count: number;
}

export interface AdminTemplate {
  id: number;
  category_id: number;
  code: string;
  name: string;
  kind: "unit" | "addon";
  default_price_unit: string;
  allowed_price_units: string[];
  allow_on_request: boolean;
  attribute_schema: AttributeField[];
  is_core: boolean;
  sort_order: number;
  active: boolean;
  /** Offerings pointing at this template (any state): keys are locked when > 0. */
  offering_count: number;
}

export interface AdminEventType {
  id: number;
  slug: string;
  name: string;
  community: string | null;
  sort_order: number;
  active: boolean;
  categories: { category_id: number; is_core: boolean }[];
}

export async function listCategories(): Promise<AdminCategory[]> {
  const r = await pool.query<AdminCategory>(
    `SELECT c.id, c.name, c.slug, c.display_name, c.icon, c.description, c.active, c.sort_order,
            c.default_price_unit, c.allowed_price_units, c.allow_on_request, c.attribute_schema,
            (SELECT count(*)::int FROM services s WHERE s.category_id = c.id AND s.active) AS active_offerings,
            (SELECT count(*)::int FROM offering_templates t WHERE t.category_id = c.id AND t.active) AS template_count
     FROM categories c ORDER BY c.active DESC, c.sort_order, c.name`
  );
  return r.rows.map((c) => ({ ...c, attribute_schema: parseAttributeSchema(c.attribute_schema) }));
}

export async function listTemplates(categoryId?: number): Promise<AdminTemplate[]> {
  const r = await pool.query<AdminTemplate>(
    `SELECT t.id, t.category_id, t.code, t.name, t.kind, t.default_price_unit, t.allowed_price_units,
            t.allow_on_request, t.attribute_schema, t.is_core, t.sort_order, t.active,
            (SELECT count(*)::int FROM services s WHERE s.template_id = t.id) AS offering_count
     FROM offering_templates t
     ${categoryId ? "WHERE t.category_id = $1" : ""}
     ORDER BY t.category_id, t.active DESC, t.sort_order, t.name`,
    categoryId ? [categoryId] : []
  );
  return r.rows.map((t) => ({ ...t, attribute_schema: parseAttributeSchema(t.attribute_schema) }));
}

export async function listEventTypes(): Promise<AdminEventType[]> {
  const r = await pool.query<AdminEventType>(
    `SELECT e.id, e.slug, e.name, e.community, e.sort_order, e.active,
            COALESCE((SELECT json_agg(json_build_object('category_id', ec.category_id, 'is_core', ec.is_core)
                                      ORDER BY ec.sort_order, ec.category_id)
                      FROM event_type_categories ec WHERE ec.event_type_id = e.id), '[]'::json) AS categories
     FROM event_types e ORDER BY e.active DESC, e.sort_order, e.name`
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CAT_AUDIT_COLS = `id, name, slug, display_name, icon, description, active, sort_order,
  default_price_unit, allowed_price_units, allow_on_request`;

export async function createCategory(body: Record<string, unknown>, actor: Actor) {
  const displayName = str(body.displayName ?? body.name, "Name", { max: 60 });
  const name = body.name !== undefined ? str(body.name, "Internal name", { max: 60 }) : displayName;
  const slug = body.slug !== undefined ? slugField(body.slug, "Slug") : slugify(displayName);
  if (!slug) bad("Name needs at least one letter or number.");
  const units = priceUnits(body.allowedPriceUnits ?? ["event"], body.defaultPriceUnit)!;
  const icon = iconField(body.icon) ?? null;
  const description = optStr(body.description, "Description", 300) ?? "";
  const allowOnRequest = optBool(body.allowOnRequest, "Price on request") ?? false;

  return withTransaction(async (client) => {
    const dup = await client.query("SELECT 1 FROM categories WHERE slug = $1 OR lower(name) = lower($2)", [slug, name]);
    if (dup.rowCount) throw new HttpError(409, "A category with that name or slug already exists.", "DUPLICATE");
    const r = await client.query(
      `INSERT INTO categories (name, slug, display_name, icon, description, default_price_unit, allowed_price_units,
                               allow_on_request, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, (SELECT COALESCE(max(sort_order),0)+1 FROM categories))
       RETURNING ${CAT_AUDIT_COLS}`,
      [name, slug, displayName, icon, description, units.def, units.units, allowOnRequest]
    );
    const row = r.rows[0];
    await audit(client, { ...actor, action: "category.create", entityType: "category", entityId: row.id, after: row });
    return row;
  });
}

export async function updateCategory(id: number, body: Record<string, unknown>, actor: Actor) {
  return withTransaction(async (client) => {
    const cur = await client.query(`SELECT ${CAT_AUDIT_COLS} FROM categories WHERE id = $1 FOR UPDATE`, [id]);
    const before = cur.rows[0];
    if (!before) throw new HttpError(404, "Category not found.", "NOT_FOUND");

    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length + 1}`);
    };
    if (body.displayName !== undefined) set("display_name", str(body.displayName, "Name", { max: 60 }));
    const icon = iconField(body.icon);
    if (icon !== undefined) set("icon", icon);
    const desc = optStr(body.description, "Description", 300);
    if (desc !== undefined) set("description", desc ?? "");
    const units = priceUnits(body.allowedPriceUnits, body.defaultPriceUnit, {
      units: before.allowed_price_units,
      def: before.default_price_unit,
    });
    if (units) {
      set("allowed_price_units", units.units);
      set("default_price_unit", units.def);
    }
    const aor = optBool(body.allowOnRequest, "Price on request");
    if (aor !== undefined) set("allow_on_request", aor);
    const sort = optInt(body.sortOrder, "Sort order", 0, 10000);
    if (sort !== undefined) set("sort_order", sort);
    const active = optBool(body.active, "Active");
    if (active !== undefined && active !== before.active) {
      if (!active) {
        const n = (
          await client.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM services WHERE category_id = $1 AND active",
            [id]
          )
        ).rows[0].n;
        if (n > 0) {
          throw new HttpError(
            409,
            `${n} active offering${n === 1 ? "" : "s"} still use${n === 1 ? "s" : ""} this category. Move or pause them before retiring it.`,
            "CATEGORY_IN_USE"
          );
        }
      }
      set("active", active);
    }
    if (!sets.length) bad("Nothing to change.");

    const r = await client.query(`UPDATE categories SET ${sets.join(", ")} WHERE id = $1 RETURNING ${CAT_AUDIT_COLS}`, [
      id,
      ...vals,
    ]);
    const after = r.rows[0];
    const action = active === false && before.active ? "category.retire" : active === true && !before.active ? "category.activate" : "category.update";
    await audit(client, { ...actor, action, entityType: "category", entityId: id, before, after });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Offering templates
// ---------------------------------------------------------------------------

const TPL_AUDIT_COLS = `id, category_id, code, name, kind, default_price_unit, allowed_price_units, allow_on_request,
  attribute_schema, is_core, sort_order, active`;

async function insertTemplate(
  client: TxClient,
  t: {
    categoryId: number;
    name: string;
    code?: string;
    kind?: "unit" | "addon";
    units?: { units: string[]; def: string };
    allowOnRequest?: boolean;
    schema?: AttributeField[];
    isCore?: boolean;
    promotedFromRequestId?: number | null;
  }
) {
  const cat = (
    await client.query(
      "SELECT id, active, allowed_price_units, default_price_unit, allow_on_request, attribute_schema FROM categories WHERE id = $1",
      [t.categoryId]
    )
  ).rows[0];
  if (!cat) bad("Pick a category.");
  if (!cat.active) throw new HttpError(409, "That category is retired. Activate it first.", "CATEGORY_RETIRED");
  const code = t.code ?? slugify(t.name).replace(/-/g, "_").slice(0, 50);
  if (!code) bad("Name needs at least one letter or number.");
  const dup = await client.query(
    "SELECT 1 FROM offering_templates WHERE category_id = $1 AND (code = $2 OR lower(name) = lower($3))",
    [t.categoryId, code, t.name]
  );
  if (dup.rowCount) throw new HttpError(409, "This category already has a template with that name.", "DUPLICATE");
  const units = t.units ?? { units: cat.allowed_price_units, def: cat.default_price_unit };
  const schema = t.schema ?? parseAttributeSchema(cat.attribute_schema);
  const r = await client.query(
    `INSERT INTO offering_templates (category_id, code, name, kind, default_price_unit, allowed_price_units,
                                    allow_on_request, attribute_schema, is_core, sort_order, promoted_from_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,
             (SELECT COALESCE(max(sort_order),0)+1 FROM offering_templates WHERE category_id = $1), $10)
     RETURNING ${TPL_AUDIT_COLS}`,
    [
      t.categoryId,
      code,
      t.name,
      t.kind ?? "unit",
      units.def,
      units.units,
      t.allowOnRequest ?? cat.allow_on_request,
      JSON.stringify(schema),
      t.isCore ?? false,
      t.promotedFromRequestId ?? null,
    ]
  );
  return r.rows[0];
}

export async function createTemplate(body: Record<string, unknown>, actor: Actor) {
  const categoryId = optInt(body.categoryId, "Category", 1, 2 ** 31 - 1);
  if (!categoryId) bad("Pick a category.");
  const name = str(body.name, "Name", { max: 80 });
  const code = body.code !== undefined ? slugField(String(body.code).replace(/_/g, "-"), "Code").replace(/-/g, "_") : undefined;
  const kind = body.kind === "addon" ? "addon" : "unit";
  const units = priceUnits(body.allowedPriceUnits, body.defaultPriceUnit);
  const schema = body.attributeSchema !== undefined ? validateAttributeSchema(body.attributeSchema) : undefined;
  const allowOnRequest = optBool(body.allowOnRequest, "Price on request");
  const isCore = optBool(body.isCore, "Core");
  return withTransaction(async (client) => {
    const row = await insertTemplate(client, { categoryId, name, code, kind, units, allowOnRequest, schema, isCore });
    await audit(client, { ...actor, action: "template.create", entityType: "template", entityId: row.id, after: row });
    return row;
  });
}

export async function updateTemplate(id: number, body: Record<string, unknown>, actor: Actor) {
  return withTransaction(async (client) => {
    const cur = await client.query(`SELECT ${TPL_AUDIT_COLS} FROM offering_templates WHERE id = $1 FOR UPDATE`, [id]);
    const before = cur.rows[0];
    if (!before) throw new HttpError(404, "Template not found.", "NOT_FOUND");
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown, cast = "") => {
      vals.push(v);
      sets.push(`${col} = $${vals.length + 1}${cast}`);
    };
    if (body.name !== undefined) {
      const name = str(body.name, "Name", { max: 80 });
      const dup = await client.query(
        "SELECT 1 FROM offering_templates WHERE category_id = $1 AND lower(name) = lower($2) AND id <> $3",
        [before.category_id, name, id]
      );
      if (dup.rowCount) throw new HttpError(409, "This category already has a template with that name.", "DUPLICATE");
      set("name", name);
    }
    const units = priceUnits(body.allowedPriceUnits, body.defaultPriceUnit, {
      units: before.allowed_price_units,
      def: before.default_price_unit,
    });
    if (units) {
      set("allowed_price_units", units.units);
      set("default_price_unit", units.def);
    }
    const aor = optBool(body.allowOnRequest, "Price on request");
    if (aor !== undefined) set("allow_on_request", aor);
    const core = optBool(body.isCore, "Core");
    if (core !== undefined) set("is_core", core);
    const sort = optInt(body.sortOrder, "Sort order", 0, 10000);
    if (sort !== undefined) set("sort_order", sort);
    let lockedKeys: string[] = [];
    if (body.attributeSchema !== undefined) {
      const next = validateAttributeSchema(body.attributeSchema);
      const prev = parseAttributeSchema(before.attribute_schema);
      const inUse = (
        await client.query<{ n: number }>("SELECT count(*)::int AS n FROM services WHERE template_id = $1", [id])
      ).rows[0].n;
      if (inUse > 0) {
        lockedKeys = prev.map((f) => f.key);
        for (const f of prev) {
          const now = next.find((x) => x.key === f.key);
          if (!now) {
            throw new HttpError(
              409,
              `The key "${f.key}" is used by ${inUse} offering${inUse === 1 ? "" : "s"} and can't be renamed or removed. Change its label instead.`,
              "KEY_IN_USE"
            );
          }
          if (now.type !== f.type) {
            throw new HttpError(409, `The type of "${f.key}" can't change while offerings use this template.`, "KEY_IN_USE");
          }
        }
      }
      set("attribute_schema", JSON.stringify(next), "::jsonb");
    }
    const active = optBool(body.active, "Active");
    if (active !== undefined && active !== before.active) {
      if (active) {
        const cat = await client.query("SELECT active FROM categories WHERE id = $1", [before.category_id]);
        if (!cat.rows[0]?.active) throw new HttpError(409, "Activate the category first.", "CATEGORY_RETIRED");
      }
      set("active", active);
    }
    if (!sets.length) bad("Nothing to change.");
    const r = await client.query(
      `UPDATE offering_templates SET ${sets.join(", ")} WHERE id = $1 RETURNING ${TPL_AUDIT_COLS}`,
      [id, ...vals]
    );
    const after = r.rows[0];
    const action =
      active === false && before.active ? "template.retire" : active === true && !before.active ? "template.activate" : "template.update";
    await audit(client, { ...actor, action, entityType: "template", entityId: id, before, after });
    const offeringCount = (
      await client.query<{ n: number }>("SELECT count(*)::int AS n FROM services WHERE template_id = $1", [id])
    ).rows[0].n;
    return { ...after, offering_count: offeringCount, locked_keys: lockedKeys };
  });
}

// ---------------------------------------------------------------------------
// Event types and "what you need" bundles
// ---------------------------------------------------------------------------

function parseBundle(v: unknown): { category_id: number; is_core: boolean }[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 30) bad("Bundle must be a list of up to 30 categories.");
  const seen = new Set<number>();
  return v.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = o.categoryId ?? o.category_id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) bad("Bundle has an invalid category.");
    if (seen.has(id)) bad("A category appears twice in the bundle.");
    seen.add(id);
    return { category_id: id, is_core: (o.isCore ?? o.is_core) !== false };
  });
}

async function writeBundle(client: TxClient, eventTypeId: number, bundle: { category_id: number; is_core: boolean }[]) {
  if (bundle.length) {
    const ok = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM categories WHERE id = ANY($1::int[])", [
      bundle.map((b) => b.category_id),
    ]);
    if (ok.rows[0].n !== bundle.length) bad("Bundle has an unknown category.");
  }
  await client.query("DELETE FROM event_type_categories WHERE event_type_id = $1", [eventTypeId]);
  for (const [i, b] of bundle.entries()) {
    await client.query(
      "INSERT INTO event_type_categories (event_type_id, category_id, is_core, sort_order) VALUES ($1,$2,$3,$4)",
      [eventTypeId, b.category_id, b.is_core, i + 1]
    );
  }
}

async function eventTypeRow(client: TxClient, id: number) {
  return (
    await client.query(
      `SELECT e.id, e.slug, e.name, e.community, e.sort_order, e.active,
              COALESCE((SELECT json_agg(json_build_object('category_id', ec.category_id, 'is_core', ec.is_core)
                                        ORDER BY ec.sort_order, ec.category_id)
                        FROM event_type_categories ec WHERE ec.event_type_id = e.id), '[]'::json) AS categories
       FROM event_types e WHERE e.id = $1`,
      [id]
    )
  ).rows[0] as AdminEventType | undefined;
}

export async function createEventType(body: Record<string, unknown>, actor: Actor) {
  const name = str(body.name, "Name", { max: 60 });
  const slug = body.slug !== undefined ? slugField(body.slug, "Slug") : slugify(name);
  if (!slug) bad("Name needs at least one letter or number.");
  const community = optStr(body.community, "Community", 40) ?? null;
  const bundle = parseBundle(body.categories) ?? [];
  return withTransaction(async (client) => {
    const dup = await client.query("SELECT 1 FROM event_types WHERE slug = $1", [slug]);
    if (dup.rowCount) throw new HttpError(409, "An event type with that name already exists.", "DUPLICATE");
    const id = (
      await client.query<{ id: number }>(
        `INSERT INTO event_types (slug, name, community, sort_order)
         VALUES ($1,$2,$3,(SELECT COALESCE(max(sort_order),0)+1 FROM event_types)) RETURNING id`,
        [slug, name, community]
      )
    ).rows[0].id;
    await writeBundle(client, id, bundle);
    const after = await eventTypeRow(client, id);
    await audit(client, { ...actor, action: "event_type.create", entityType: "event_type", entityId: id, after });
    return after!;
  });
}

export async function updateEventType(id: number, body: Record<string, unknown>, actor: Actor) {
  return withTransaction(async (client) => {
    const lock = await client.query("SELECT id FROM event_types WHERE id = $1 FOR UPDATE", [id]);
    if (!lock.rowCount) throw new HttpError(404, "Event type not found.", "NOT_FOUND");
    const before = await eventTypeRow(client, id);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length + 1}`);
    };
    if (body.name !== undefined) set("name", str(body.name, "Name", { max: 60 }));
    const community = optStr(body.community, "Community", 40);
    if (community !== undefined) set("community", community);
    const sort = optInt(body.sortOrder, "Sort order", 0, 10000);
    if (sort !== undefined) set("sort_order", sort);
    const active = optBool(body.active, "Active");
    if (active !== undefined) set("active", active);
    const bundle = parseBundle(body.categories);
    if (!sets.length && !bundle) bad("Nothing to change.");
    if (sets.length) await client.query(`UPDATE event_types SET ${sets.join(", ")} WHERE id = $1`, [id, ...vals]);
    if (bundle) await writeBundle(client, id, bundle);
    const after = await eventTypeRow(client, id);
    const action =
      active === false && before?.active ? "event_type.retire" : active === true && !before?.active ? "event_type.activate" : "event_type.update";
    await audit(client, { ...actor, action, entityType: "event_type", entityId: id, before, after });
    return after!;
  });
}

// ---------------------------------------------------------------------------
// Custom "Other" offering queue
// ---------------------------------------------------------------------------

export const CUSTOM_STATUSES = ["pending", "promoted", "merged", "kept_private", "rejected"] as const;
export type CustomStatus = (typeof CUSTOM_STATUSES)[number];

export interface CustomGroup {
  normalised_name: string;
  /** Most common raw spelling, for the default template name. */
  display_name: string;
  raw_names: string[];
  vendor_count: number;
  request_count: number;
  request_ids: number[];
  sample_vendors: { id: number; name: string }[];
  categories: { id: number; name: string; count: number }[];
  flagged_contact: boolean;
  oldest_at: string;
  latest_at: string;
  /** Promotion is suggested once 3+ vendors use the same name (plan 3.5.6). */
  suggested: boolean;
  /** Templates whose name normalises to the same value (merge candidates). */
  matching_templates: { id: number; name: string; category_id: number }[];
}

export async function listCustomGroups(status: CustomStatus = "pending"): Promise<CustomGroup[]> {
  const r = await pool.query<CustomGroup & { raw_counts: { raw: string; n: number }[] }>(
    `WITH req AS (
       SELECT r.*, v.name AS vendor_name, c.display_name AS category_name
       FROM custom_offering_requests r
       JOIN vendors v ON v.id = r.vendor_id
       JOIN categories c ON c.id = r.category_id
       WHERE r.status = $1
     )
     SELECT g.normalised_name,
            count(DISTINCT g.vendor_id)::int AS vendor_count,
            count(*)::int AS request_count,
            array_agg(g.id ORDER BY g.id) AS request_ids,
            bool_or(g.flagged_contact) AS flagged_contact,
            min(g.created_at) AS oldest_at,
            max(g.created_at) AS latest_at,
            (SELECT json_agg(x ORDER BY x.n DESC, x.raw) FROM (
               SELECT raw_name AS raw, count(*)::int AS n FROM req r2
               WHERE r2.normalised_name = g.normalised_name GROUP BY raw_name) x) AS raw_counts,
            (SELECT json_agg(json_build_object('id', y.vendor_id, 'name', y.vendor_name) ORDER BY y.vendor_name) FROM (
               SELECT DISTINCT vendor_id, vendor_name FROM req r3
               WHERE r3.normalised_name = g.normalised_name ORDER BY vendor_name LIMIT 5) y) AS sample_vendors,
            (SELECT json_agg(json_build_object('id', z.category_id, 'name', z.category_name, 'count', z.n) ORDER BY z.n DESC, z.category_name)
             FROM (SELECT category_id, category_name, count(*)::int AS n FROM req r4
                   WHERE r4.normalised_name = g.normalised_name GROUP BY category_id, category_name) z) AS categories
     FROM req g
     GROUP BY g.normalised_name
     ORDER BY count(DISTINCT g.vendor_id) DESC, count(*) DESC, min(g.created_at), g.normalised_name
     LIMIT 200`,
    [status]
  );
  const templates = (
    await pool.query<{ id: number; name: string; category_id: number }>(
      "SELECT id, name, category_id FROM offering_templates WHERE active ORDER BY name"
    )
  ).rows;
  const byNorm = new Map<string, { id: number; name: string; category_id: number }[]>();
  for (const t of templates) {
    const k = normaliseCustomName(t.name);
    byNorm.set(k, [...(byNorm.get(k) ?? []), t]);
  }
  return r.rows.map(({ raw_counts, ...g }) => ({
    ...g,
    display_name: raw_counts?.[0]?.raw ?? g.normalised_name,
    raw_names: (raw_counts ?? []).map((x) => x.raw),
    sample_vendors: g.sample_vendors ?? [],
    categories: g.categories ?? [],
    suggested: g.vendor_count >= 3,
    matching_templates: byNorm.get(g.normalised_name) ?? [],
  }));
}

export async function countPendingCustom(): Promise<number> {
  const r = await pool.query<{ n: number }>(
    "SELECT count(DISTINCT normalised_name)::int AS n FROM custom_offering_requests WHERE status = 'pending'"
  );
  return r.rows[0].n;
}

export type ResolveAction = "promote" | "merge" | "keep_private" | "reject";

interface ResolvedRequest {
  id: number;
  service_id: number | null;
  vendor_id: number;
  category_id: number;
  raw_name: string;
  normalised_name: string;
  owner_id: number | null;
}

/**
 * Resolves a group of pending custom requests in ONE transaction with ONE
 * audit row. Selection: `normalisedName` (every pending request with that
 * name) and/or explicit `ids` (all must still be pending, else 409).
 */
export async function resolveCustom(body: Record<string, unknown>, actor: Actor & { reason?: string | null }) {
  const action = body.action as ResolveAction;
  if (!["promote", "merge", "keep_private", "reject"].includes(action)) bad("Pick an action.");
  const ids = body.ids === undefined ? undefined : body.ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 500 || !ids.every((x) => Number.isInteger(x) && x > 0))) {
    bad("ids must be a list of request ids.");
  }
  const norm = typeof body.normalisedName === "string" ? body.normalisedName.trim() : undefined;
  if (!norm && !(ids as number[] | undefined)?.length) bad("Choose which requests to resolve.");
  const reason = actor.reason ?? null;
  if (action === "reject" && !reason) bad("Give the vendor a reason (at least 3 characters).", "REASON_REQUIRED");

  return withTransaction(async (client) => {
    const where: string[] = [];
    const vals: unknown[] = [];
    if (ids && (ids as number[]).length) {
      vals.push(ids);
      where.push(`r.id = ANY($${vals.length}::int[])`);
    }
    if (norm) {
      vals.push(norm);
      where.push(`r.normalised_name = $${vals.length}`);
    }
    const sel = await client.query<ResolvedRequest & { status: string }>(
      `SELECT r.id, r.service_id, r.vendor_id, r.category_id, r.raw_name, r.normalised_name, r.status, v.owner_id
       FROM custom_offering_requests r JOIN vendors v ON v.id = r.vendor_id
       WHERE ${where.join(" AND ")}
       ORDER BY r.id FOR UPDATE OF r`,
      vals
    );
    if (ids && (ids as number[]).length && sel.rows.length !== new Set(ids as number[]).size) {
      throw new HttpError(404, "Some requests no longer exist.", "NOT_FOUND");
    }
    if (ids && (ids as number[]).length && sel.rows.some((r) => r.status !== "pending")) {
      throw new HttpError(409, "Someone already handled some of these requests. Refresh the queue.", "ALREADY_HANDLED");
    }
    const reqs = sel.rows.filter((r) => r.status === "pending");
    if (!reqs.length) throw new HttpError(409, "Nothing left to resolve here. Refresh the queue.", "ALREADY_HANDLED");
    const reqIds = reqs.map((r) => r.id);
    const serviceIds = [...new Set(reqs.map((r) => r.service_id).filter((x): x is number => x !== null))];
    const vendorIds = [...new Set(reqs.map((r) => r.vendor_id))];

    let template: { id: number; name: string; category_id: number } | null = null;
    let createdTemplate = false;
    if (action === "promote") {
      const nt = (body.newTemplate ?? {}) as Record<string, unknown>;
      const categoryId = optInt(nt.categoryId, "Category", 1, 2 ** 31 - 1) ?? mostCommon(reqs.map((r) => r.category_id));
      const name = str(nt.name ?? reqs[0].raw_name, "Template name", { max: 80 });
      const units = priceUnits(nt.allowedPriceUnits, nt.defaultPriceUnit);
      const row = await insertTemplate(client, {
        categoryId,
        name,
        units,
        promotedFromRequestId: reqIds[0],
      });
      template = { id: row.id, name: row.name, category_id: row.category_id };
      createdTemplate = true;
      // The new active template is what makes it a filter chip: it is served
      // by /api/meta/taxonomy (offering filter, vendor picker) once the route
      // handler expires the taxonomy cache.
    } else if (action === "merge") {
      const tid = optInt(body.templateId, "Template", 1, 2 ** 31 - 1);
      if (!tid) bad("Pick the template to merge into.");
      const t = await client.query("SELECT id, name, category_id, active FROM offering_templates WHERE id = $1", [tid]);
      if (!t.rows[0]) bad("That template doesn't exist.");
      if (!t.rows[0].active) throw new HttpError(409, "That template is retired. Pick an active one.", "TEMPLATE_RETIRED");
      template = { id: t.rows[0].id, name: t.rows[0].name, category_id: t.rows[0].category_id };
    }

    if (template && serviceIds.length) {
      // Re-point every matching offering in one statement: template set,
      // category follows the template, custom_name cleared (title keeps the
      // vendor's own wording as the label).
      await client.query(
        `UPDATE services SET template_id = $2, category_id = $3, custom_name = NULL, updated_at = now()
         WHERE id = ANY($1::int[])`,
        [serviceIds, template.id, template.category_id]
      );
    }
    if (action === "reject" && serviceIds.length) {
      await client.query(
        "UPDATE services SET hidden_reason = 'admin', updated_at = now() WHERE id = ANY($1::int[])",
        [serviceIds]
      );
      for (const v of vendorIds) await recomputeVendorPrice(v, client);
    }

    const status = { promote: "promoted", merge: "merged", keep_private: "kept_private", reject: "rejected" }[action];
    await client.query(
      `UPDATE custom_offering_requests
       SET status = $2, resolved_template_id = $3, resolved_by = $4, resolved_at = now(), note = $5
       WHERE id = ANY($1::int[])`,
      [reqIds, status, template?.id ?? null, actor.actorId, reason]
    );

    // Vendor-facing notifications (one per affected owner).
    const owners = new Map<number, string>();
    for (const r of reqs) if (r.owner_id) owners.set(r.owner_id, r.raw_name);
    for (const [ownerId, rawName] of owners) {
      if (action === "promote" || action === "merge") {
        await notify(
          client,
          ownerId,
          action === "promote" ? "offering.promoted" : "offering.merged",
          `"${rawName}" is now a standard offering`,
          `Your offering now uses the "${template!.name}" template, so customers can find it with the search filters.`,
          "/vendor/offerings",
          { templateId: template!.id }
        );
      } else if (action === "reject") {
        await notify(
          client,
          ownerId,
          "offering.rejected",
          `"${rawName}" was hidden`,
          `Our team hid this offering. Reason: ${reason}`,
          "/vendor/offerings",
          { reason }
        );
      }
    }

    const after = {
      status,
      request_ids: reqIds,
      service_ids: serviceIds,
      vendor_ids: vendorIds,
      template_id: template?.id ?? null,
      template_created: createdTemplate,
    };
    await audit(client, {
      ...actor,
      action: `custom_offering.${action}`,
      entityType: "custom_offering",
      entityId: reqs[0].normalised_name,
      before: { status: "pending", request_ids: reqIds },
      after,
      reason,
    });
    return { ...after, template, affected_offerings: serviceIds.length, affected_vendors: vendorIds.length };
  });
}

function mostCommon(xs: number[]): number {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
