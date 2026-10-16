import { pool } from "./db";

// ---------- Packages ----------

export interface PackageRecord {
  id: number;
  vendor_id: number;
  name: string;
  price: number;
  items: string[];
}

export const MAX_PACKAGES = 6;

export async function listPackages(vendorId: number): Promise<PackageRecord[]> {
  const result = await pool.query<PackageRecord>(
    "SELECT id, vendor_id, name, price, items FROM vendor_packages WHERE vendor_id = $1 ORDER BY price ASC, id ASC",
    [vendorId]
  );
  return result.rows;
}

export async function addPackage(
  vendorId: number,
  ownerId: number,
  pkg: { name: string; price: number; items: string[] }
): Promise<PackageRecord | null> {
  // Ownership is checked inside the INSERT (same pattern as listing edits).
  const result = await pool.query<PackageRecord>(
    `INSERT INTO vendor_packages (vendor_id, name, price, items)
     SELECT v.id, $3, $4, $5 FROM vendors v WHERE v.id = $1 AND v.owner_id = $2
     RETURNING id, vendor_id, name, price, items`,
    [vendorId, ownerId, pkg.name, pkg.price, pkg.items]
  );
  return result.rows[0] ?? null;
}

export async function deletePackage(packageId: number, ownerId: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM vendor_packages p USING vendors v
     WHERE p.id = $1 AND p.vendor_id = v.id AND v.owner_id = $2`,
    [packageId, ownerId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------- Portfolio ----------

export interface PortfolioItem {
  id: number;
  vendor_id: number;
  url: string;
  caption: string | null;
}

export const MAX_PORTFOLIO_ITEMS = 24;

export async function listPortfolio(vendorId: number): Promise<PortfolioItem[]> {
  const result = await pool.query<PortfolioItem>(
    "SELECT id, vendor_id, url, caption FROM portfolio_items WHERE vendor_id = $1 ORDER BY created_at DESC, id DESC",
    [vendorId]
  );
  return result.rows;
}

export async function addPortfolioItem(
  vendorId: number,
  ownerId: number,
  url: string,
  caption: string | null
): Promise<PortfolioItem | null> {
  const result = await pool.query<PortfolioItem>(
    `INSERT INTO portfolio_items (vendor_id, url, caption)
     SELECT v.id, $3, $4 FROM vendors v WHERE v.id = $1 AND v.owner_id = $2
     RETURNING id, vendor_id, url, caption`,
    [vendorId, ownerId, url, caption]
  );
  return result.rows[0] ?? null;
}

export async function deletePortfolioItem(itemId: number, ownerId: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM portfolio_items p USING vendors v
     WHERE p.id = $1 AND p.vendor_id = v.id AND v.owner_id = $2`,
    [itemId, ownerId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------- Availability ----------

// Upcoming (today or later) unavailable dates as YYYY-MM-DD strings.
export async function listUnavailableDates(vendorId: number): Promise<string[]> {
  const result = await pool.query<{ date: string }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date FROM vendor_unavailable_dates
     WHERE vendor_id = $1 AND date >= CURRENT_DATE ORDER BY date`,
    [vendorId]
  );
  return result.rows.map((r) => r.date);
}

export async function isDateUnavailable(vendorId: number, date: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM vendor_unavailable_dates WHERE vendor_id = $1 AND date = $2::date",
    [vendorId, date]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markDateUnavailable(vendorId: number, date: string): Promise<void> {
  await pool.query(
    "INSERT INTO vendor_unavailable_dates (vendor_id, date) VALUES ($1, $2::date) ON CONFLICT DO NOTHING",
    [vendorId, date]
  );
}

// Replaces the vendor's upcoming unavailable dates with `dates`. Returns false
// when the caller doesn't own the vendor.
export async function replaceUnavailableDates(
  vendorId: number,
  ownerId: number,
  dates: string[]
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query("SELECT 1 FROM vendors WHERE id = $1 AND owner_id = $2", [
      vendorId,
      ownerId,
    ]);
    if ((owned.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "DELETE FROM vendor_unavailable_dates WHERE vendor_id = $1 AND date >= CURRENT_DATE",
      [vendorId]
    );
    if (dates.length > 0) {
      await client.query(
        `INSERT INTO vendor_unavailable_dates (vendor_id, date)
         SELECT $1, d FROM unnest($2::date[]) AS d ON CONFLICT DO NOTHING`,
        [vendorId, dates]
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
