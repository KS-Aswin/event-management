import type { PoolClient } from "pg";
import { pool } from "@/lib/db";

/** A pg client (pool client inside a transaction) or anything with .query. */
export type TxClient = Pick<PoolClient, "query">;

/**
 * Runs fn inside BEGIN/COMMIT on one pooled client; ROLLBACK on any throw.
 * Every admin mutation uses this so the change, its audit() row and its
 * notify() row commit or fail together.
 *
 *   const out = await withTransaction(async (client) => {
 *     const before = (await client.query("SELECT ... FOR UPDATE", [id])).rows[0];
 *     await client.query("UPDATE ...");
 *     await audit(client, { actorId, action: "vendor.approve", entityType: "vendor", entityId: id, before, after });
 *     return after;
 *   });
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Error to throw inside withTransaction to roll back and answer with a status (e.g. 409 "already handled"). */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}
