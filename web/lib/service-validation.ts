import { SERVICE_PRICE_UNITS } from "./db";

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
      !(SERVICE_PRICE_UNITS as readonly string[]).includes(raw.priceUnit)
    ) {
      return { ok: false, error: `Price unit must be one of: ${SERVICE_PRICE_UNITS.join(", ")}.` };
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
