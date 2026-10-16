import { createHash, randomBytes } from "crypto";
import { pool } from "./db";

export type TokenPurpose = "reset" | "verify";

const TTL_MS: Record<TokenPurpose, number> = {
  reset: 60 * 60 * 1000, // 1 hour
  verify: 24 * 60 * 60 * 1000, // 24 hours
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Returns the raw token (to put in an emailed link). Only its hash is stored.
export async function createAuthToken(userId: number, purpose: TokenPurpose): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3,$4)`,
    [userId, purpose, sha256(token), new Date(Date.now() + TTL_MS[purpose])]
  );
  return token;
}

// Atomically marks the token used and returns its user id, or null when the
// token is unknown, expired, already used, or for a different purpose.
export async function consumeAuthToken(token: string, purpose: TokenPurpose): Promise<number | null> {
  const result = await pool.query<{ user_id: number }>(
    `UPDATE auth_tokens SET used = true
     WHERE token_hash = $1 AND purpose = $2 AND used = false AND expires_at > now()
     RETURNING user_id`,
    [sha256(token), purpose]
  );
  return result.rows[0]?.user_id ?? null;
}
