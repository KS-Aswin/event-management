// Unit tests for lib/offering-validation.ts (P0-9). No server or database
// needed. Run with:  node --test tests/offering-validation.test.mjs
// (Node 22.18+ / 24 strips the TypeScript types when importing the .ts file.)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAttributeValue,
  validateAttributes,
  parseAttributeSchema,
  parseOfferingBody,
  parsePackageItems,
  packageRules,
  maskContactDetails,
  normaliseCustomName,
  formatOfferingPrice,
  formatVendorPriceLabel,
  parseServiceBody,
  PRICE_UNITS,
} from "../lib/offering-validation.ts";

const photoSchema = [
  { key: "photographers", label: "Photographers", type: "int", min: 1, max: 50, required: true },
  { key: "coverage_hours", label: "Coverage hours", type: "number", min: 0.5, max: 72 },
  { key: "drone", label: "Drone included", type: "bool" },
  { key: "album_type", label: "Album type", type: "enum", options: ["none", "standard", "premium"] },
  { key: "serves_at", label: "Serves at", type: "multi", options: ["hall", "home"] },
  { key: "languages", label: "Languages", type: "tags", max: 3 },
  { key: "note", label: "Note", type: "text", max: 10 },
];

const photoRules = {
  allowedPriceUnits: ["event", "day", "hour"],
  defaultPriceUnit: "event",
  allowOnRequest: false,
  attributeSchema: photoSchema,
};

// ---------- per field type ----------

test("int: accepts integers and numeric strings, enforces bounds", () => {
  const f = photoSchema[0];
  assert.deepEqual(validateAttributeValue(f, 3), { ok: true, value: 3 });
  assert.deepEqual(validateAttributeValue(f, "4"), { ok: true, value: 4 });
  assert.equal(validateAttributeValue(f, 2.5).ok, false);
  assert.equal(validateAttributeValue(f, 0).ok, false);
  assert.equal(validateAttributeValue(f, 51).ok, false);
  assert.equal(validateAttributeValue(f, "abc").ok, false);
});

test("number: accepts decimals within bounds", () => {
  const f = photoSchema[1];
  assert.deepEqual(validateAttributeValue(f, 2.5), { ok: true, value: 2.5 });
  assert.equal(validateAttributeValue(f, 0.1).ok, false);
  assert.equal(validateAttributeValue(f, Infinity).ok, false);
});

test("bool: accepts booleans and common form strings", () => {
  const f = photoSchema[2];
  assert.deepEqual(validateAttributeValue(f, true), { ok: true, value: true });
  assert.deepEqual(validateAttributeValue(f, "on"), { ok: true, value: true });
  assert.deepEqual(validateAttributeValue(f, "false"), { ok: true, value: false });
  assert.equal(validateAttributeValue(f, "maybe").ok, false);
});

test("enum: only listed options", () => {
  const f = photoSchema[3];
  assert.deepEqual(validateAttributeValue(f, "premium"), { ok: true, value: "premium" });
  assert.equal(validateAttributeValue(f, "gold").ok, false);
});

test("multi: list of listed options, de-duplicated", () => {
  const f = photoSchema[4];
  assert.deepEqual(validateAttributeValue(f, ["hall", "home", "hall"]), { ok: true, value: ["hall", "home"] });
  assert.deepEqual(validateAttributeValue(f, "hall,home"), { ok: true, value: ["hall", "home"] });
  assert.equal(validateAttributeValue(f, ["hall", "beach"]).ok, false);
  assert.deepEqual(validateAttributeValue(f, []), { ok: true, value: undefined });
});

test("tags: free text list, trimmed, case-insensitive de-dup, max count", () => {
  const f = photoSchema[5];
  assert.deepEqual(validateAttributeValue(f, [" Malayalam ", "malayalam", "English"]), {
    ok: true,
    value: ["Malayalam", "English"],
  });
  assert.equal(validateAttributeValue(f, ["a", "b", "c", "d"]).ok, false);
  assert.equal(validateAttributeValue(f, [1, 2]).ok, false);
});

test("text: trimmed, max length", () => {
  const f = photoSchema[6];
  assert.deepEqual(validateAttributeValue(f, "  hi  there "), { ok: true, value: "hi there" });
  assert.equal(validateAttributeValue(f, "this is far too long").ok, false);
  assert.deepEqual(validateAttributeValue(f, "   "), { ok: true, value: undefined });
});

// ---------- schema-level ----------

test("unknown attribute keys are stripped", () => {
  const r = validateAttributes(photoSchema, { photographers: 2, hacker: "x", __proto__x: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.attributes, { photographers: 2 });
});

test("missing required attribute fails with the field name", () => {
  const r = validateAttributes(photoSchema, { drone: true });
  assert.equal(r.ok, false);
  assert.equal(r.field, "attributes.photographers");
  assert.equal(r.code, "VALIDATION");
});

test("partial validation only checks required fields that are sent", () => {
  assert.equal(validateAttributes(photoSchema, { drone: true }, { partial: true }).ok, true);
  assert.equal(validateAttributes(photoSchema, { photographers: "" }, { partial: true }).ok, false);
});

test("attributes must be an object", () => {
  assert.equal(validateAttributes(photoSchema, [1, 2]).ok, false);
  assert.equal(validateAttributes(photoSchema, "x").ok, false);
});

test("parseAttributeSchema drops malformed entries", () => {
  const s = parseAttributeSchema([
    { key: "ok_key", label: "OK", type: "int" },
    { key: "Bad Key", type: "int" },
    { key: "x", type: "colour" },
    null,
  ]);
  assert.equal(s.length, 1);
  assert.equal(s[0].key, "ok_key");
});

// ---------- offering body ----------

const validUnit = { templateId: 5, priceFrom: 45000, priceUnit: "event", attributes: { photographers: 2 } };

test("valid unit offering parses", () => {
  const r = parseOfferingBody(validUnit, { requireAll: true, rules: photoRules });
  assert.equal(r.ok, true);
  assert.equal(r.fields.priceFrom, 45000);
  assert.deepEqual(r.fields.attributes, { photographers: 2 });
});

test("on_request on a template that doesn't allow it gets 400", () => {
  const r = parseOfferingBody({ ...validUnit, priceMode: "on_request" }, { requireAll: true, rules: photoRules });
  assert.equal(r.ok, false);
  assert.equal(r.field, "priceMode");
});

test("on_request is accepted where allowed and stores price 0", () => {
  const r = parseOfferingBody(
    { templateId: 1, priceMode: "on_request" },
    { requireAll: true, rules: { ...photoRules, allowOnRequest: true, attributeSchema: [] } }
  );
  assert.equal(r.ok, true);
  assert.equal(r.fields.priceFrom, 0);
});

test("a unit outside allowed_price_units gets 400", () => {
  const r = parseOfferingBody({ ...validUnit, priceUnit: "plate" }, { requireAll: true, rules: photoRules });
  assert.equal(r.ok, false);
  assert.equal(r.field, "priceUnit");
  const bogus = parseOfferingBody({ ...validUnit, priceUnit: "bogus" }, { requireAll: true });
  assert.equal(bogus.ok, false);
});

test("missing price unit defaults to the template default", () => {
  const { priceUnit, ...rest } = validUnit;
  void priceUnit;
  const r = parseOfferingBody(rest, { requireAll: true, rules: photoRules });
  assert.equal(r.fields.priceUnit, "event");
});

test("price 0 without on_request is rejected", () => {
  const r = parseOfferingBody({ ...validUnit, priceFrom: 0 }, { requireAll: true, rules: photoRules });
  assert.equal(r.ok, false);
  assert.equal(r.field, "priceFrom");
});

test("range needs price_to >= price_from (also against the stored row)", () => {
  assert.equal(
    parseOfferingBody({ ...validUnit, priceMode: "range", priceTo: 40000 }, { requireAll: true, rules: photoRules }).field,
    "priceTo"
  );
  assert.equal(
    parseOfferingBody({ ...validUnit, priceMode: "range", priceTo: 60000 }, { requireAll: true, rules: photoRules }).ok,
    true
  );
  const upd = parseOfferingBody(
    { priceTo: 100 },
    { requireAll: false, existing: { price_mode: "range", price_from: 500, price_to: 900 } }
  );
  assert.equal(upd.ok, false);
});

test("qty: decimals allowed to 2 places, max >= min", () => {
  assert.equal(parseOfferingBody({ minQty: 0.5, qtyStep: 0.5 }, { requireAll: false }).ok, true);
  assert.equal(parseOfferingBody({ minQty: 0.555 }, { requireAll: false }).ok, false);
  assert.equal(parseOfferingBody({ minQty: 100, maxQty: 50 }, { requireAll: false }).field, "maxQty");
  assert.equal(parseOfferingBody({ maxQty: 50 }, { requireAll: false, existing: { min_qty: "100.00" } }).field, "maxQty");
});

test("guests: max >= min", () => {
  assert.equal(parseOfferingBody({ guestMin: 500, guestMax: 100 }, { requireAll: false }).field, "guestMax");
});

test("add-on needs a parent; non-add-ons can't have one", () => {
  assert.equal(
    parseOfferingBody({ ...validUnit, kind: "addon" }, { requireAll: true, rules: photoRules }).field,
    "parentServiceId"
  );
  assert.equal(
    parseOfferingBody({ ...validUnit, kind: "addon", parentServiceId: 9 }, { requireAll: true, rules: photoRules }).ok,
    true
  );
  assert.equal(parseOfferingBody({ ...validUnit, parentServiceId: 9 }, { requireAll: true, rules: photoRules }).ok, false);
});

test("package can't be package_only and needs a title", () => {
  const rules = packageRules();
  assert.equal(
    parseOfferingBody({ kind: "package", title: "Hindu wedding basic", saleMode: "package_only", priceFrom: 1 }, { requireAll: true, rules }).field,
    "saleMode"
  );
  assert.equal(parseOfferingBody({ kind: "package", priceFrom: 100 }, { requireAll: true, rules }).field, "title");
  assert.equal(
    parseOfferingBody({ kind: "package", title: "Hindu wedding basic", priceMode: "on_request" }, { requireAll: true, rules }).ok,
    true
  );
});

test("sale mode and fulfilment are validated", () => {
  assert.equal(parseOfferingBody({ saleMode: "sometimes" }, { requireAll: false }).field, "saleMode");
  assert.equal(parseOfferingBody({ fulfilment: "outsourced" }, { requireAll: false }).field, "fulfilment");
  const r = parseOfferingBody({ saleMode: "package_only", fulfilment: "partner" }, { requireAll: false });
  assert.equal(r.ok, true);
});

test("Other: custom name becomes the title and contact details are masked + flagged", () => {
  const r = parseOfferingBody(
    { customName: "Kolkali team call 98470 12345", categoryId: 8, priceFrom: 15000 },
    { requireAll: true, rules: { ...photoRules, attributeSchema: [] } }
  );
  assert.equal(r.ok, true);
  assert.equal(r.fields.flaggedContact, true);
  assert.ok(!/\d{5}/.test(r.fields.customName));
  assert.equal(r.fields.title, r.fields.customName);
});

test("a unit needs a template or a custom name", () => {
  const r = parseOfferingBody({ priceFrom: 100 }, { requireAll: true, rules: photoRules });
  assert.equal(r.ok, false);
  assert.equal(r.field, "templateId");
});

test("package items: ids, qty, de-dup", () => {
  assert.equal(parsePackageItems([]).ok, false);
  assert.equal(parsePackageItems([{ serviceId: 1 }, { serviceId: 1 }]).ok, false);
  assert.equal(parsePackageItems([{ serviceId: 1, qty: 0 }]).ok, false);
  const r = parsePackageItems([{ serviceId: 1, qty: 300, note: "sadhya" }, { serviceId: 2 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items[1], { serviceId: 2, qty: 1, note: "" });
});

// ---------- helpers ----------

test("maskContactDetails catches phones, emails and URLs", () => {
  for (const s of ["+91 98470 12345", "call 9847012345", "me@example.com", "www.mysite.in", "https://x.y/z", "mysite.com"]) {
    assert.equal(maskContactDetails(s).flagged, true, s);
  }
  assert.equal(maskContactDetails("Up to 1,000 guests, 5 hours").flagged, false);
});

test("normaliseCustomName collapses punctuation and strips suffixes", () => {
  assert.equal(normaliseCustomName("Kolkali  Team!"), "kolkali");
  assert.equal(normaliseCustomName("Duff-Muttu service"), "duff muttu");
  assert.equal(normaliseCustomName("Team"), "team");
});

test("price formatting", () => {
  assert.equal(formatOfferingPrice({ price_mode: "from", price_from: 45000, price_unit: "event" }), "Starting from ₹45,000 per event");
  assert.equal(formatOfferingPrice({ price_mode: "fixed", price_from: 600, price_unit: "plate", unit_label: "leaf" }), "₹600 per leaf");
  assert.equal(formatOfferingPrice({ price_mode: "range", price_from: 1000, price_to: 2000, price_unit: "day" }), "₹1,000 – ₹2,000 per day");
  assert.equal(formatOfferingPrice({ price_mode: "on_request", price_from: 0, price_unit: "event" }), "Price on request");
  assert.equal(formatVendorPriceLabel({ price_from: 45000, price_unit: "event" }), "₹45,000 onwards");
  assert.equal(formatVendorPriceLabel({ price_from: 600, price_unit: "plate" }), "₹600 per plate");
  assert.equal(formatVendorPriceLabel(null), "Price on request");
});

test("legacy parseServiceBody still works", () => {
  assert.equal(parseServiceBody({ category: "Photography", title: "Candid", priceFrom: 100 }, true).ok, true);
  assert.equal(parseServiceBody({ priceUnit: "kg" }, false).ok, false);
});

test("PRICE_UNITS includes piece and the plan's 15 units", () => {
  assert.equal(PRICE_UNITS.length, 16);
  assert.ok(PRICE_UNITS.includes("piece"));
});
