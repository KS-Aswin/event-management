// QA-069: once a listing is live (approved), the vendor can't delete or
// switch off their last priced offering customers can book on its own. This
// matches the submit rule in findListingMissing ("offering") and the photo
// minimum for live listings (lib/media/listing-minimum.ts). A listing under
// review or in draft isn't blocked: the vendor home warns instead.

import { pool } from "@/lib/db";

type Mode = "on_request" | "from" | "fixed" | "range" | string;

interface Row {
  id: number;
  kind: "unit" | "addon" | "package";
  active: boolean;
  incomplete: boolean;
  hidden: boolean;
  sale_mode: string;
  price_mode: Mode;
  price_from: number;
}

export type OfferingChange =
  | { kind: "remove"; id: number }
  | {
      kind: "patch";
      id: number;
      active?: boolean;
      saleMode?: string;
      priceMode?: Mode;
      priceFrom?: number;
      /** New package item ids, when the package's items are replaced. */
      items?: number[];
    };

const qualifies = (r: Row) =>
  r.active &&
  !r.incomplete &&
  !r.hidden &&
  (r.kind === "unit" || r.kind === "package") &&
  r.sale_mode === "separate" &&
  (r.price_mode === "on_request" || r.price_from > 0);

export const OFFERING_MINIMUM_MESSAGE =
  "Your listing is live, so customers need at least one priced offering or package they can book on its own. " +
  "Add or turn on another one first, then change this one.";

/**
 * Returns an error message when the change would leave a live listing
 * without a bookable priced offering, else null. Only blocks a change that
 * removes the last one (a listing already short can still be edited).
 */
export async function checkOfferingMinimum(
  vendor: { id: number; status: string },
  change: OfferingChange
): Promise<string | null> {
  if (vendor.status !== "approved") return null;
  const [svc, items] = await Promise.all([
    pool.query<Row>(
      `SELECT id, kind, active, incomplete, hidden_reason IS NOT NULL AS hidden, sale_mode,
              price_mode, price_from::float8 AS price_from
         FROM services WHERE vendor_id = $1`,
      [vendor.id]
    ),
    pool.query<{ package_id: number; item_id: number }>(
      `SELECT pi.package_id, pi.item_id FROM package_items pi
         JOIN services p ON p.id = pi.package_id WHERE p.vendor_id = $1`,
      [vendor.id]
    ),
  ]);
  const before = svc.rows;
  if (!before.some(qualifies)) return null;

  // Simulate the change.
  const byId = new Map(before.map((r) => [r.id, { ...r }]));
  const target = byId.get(change.id);
  if (!target) return null;
  let pkgItems = items.rows;
  if (change.kind === "remove") {
    // Mirrors removeOffering (lib/db.ts): an offering that enquiries or offer
    // lines refer to is switched off, and every package holding it becomes
    // incomplete (DB trigger). Otherwise it is deleted: its package_items rows
    // go, and a package is incomplete only if no items are left or a
    // remaining item is off.
    const used = await pool.query(
      `SELECT 1 FROM quote_request_services WHERE service_id = $1
       UNION ALL SELECT 1 FROM quote_offer_lines WHERE service_id = $1 LIMIT 1`,
      [change.id]
    );
    target.active = false;
    const touched = new Set(pkgItems.filter((pi) => pi.item_id === change.id).map((pi) => pi.package_id));
    if (used.rowCount) {
      for (const pid of touched) {
        const p = byId.get(pid);
        if (p) p.incomplete = true;
      }
    } else {
      byId.delete(change.id);
      pkgItems = pkgItems.filter((pi) => pi.item_id !== change.id && pi.package_id !== change.id);
      for (const pid of touched) {
        const p = byId.get(pid);
        if (!p) continue;
        const left = pkgItems.filter((pi) => pi.package_id === pid);
        p.incomplete = left.length === 0 || left.some((pi) => byId.get(pi.item_id)?.active === false);
      }
    }
  } else {
    if (change.active !== undefined) target.active = change.active;
    if (change.saleMode !== undefined) target.sale_mode = change.saleMode;
    if (change.priceMode !== undefined) target.price_mode = change.priceMode;
    if (change.priceFrom !== undefined) target.price_from = change.priceFrom;
    if (change.items && target.kind === "package") {
      pkgItems = [
        ...pkgItems.filter((pi) => pi.package_id !== target.id),
        ...change.items.map((item_id) => ({ package_id: target.id, item_id })),
      ];
    }
    // Packages' `incomplete` follows their items' `active` (DB trigger).
    const touched = new Set(
      pkgItems
        .filter((pi) => pi.item_id === target.id || pi.package_id === target.id)
        .map((pi) => pi.package_id)
    );
    for (const pid of touched) {
      const p = byId.get(pid);
      if (!p) continue;
      p.incomplete = pkgItems.some((pi) => pi.package_id === pid && byId.get(pi.item_id)?.active === false);
    }
  }
  return [...byId.values()].some(qualifies) ? null : OFFERING_MINIMUM_MESSAGE;
}
