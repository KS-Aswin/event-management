import { Pool } from "pg";

// Reuse a single pool across hot reloads in dev (Next.js re-evaluates
// modules on every request in dev mode without this guard, which would
// otherwise leak a new connection pool per request).
declare global {
  // eslint-disable-next-line no-var
  var _velaPgPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
    );
  }
  return new Pool({ connectionString });
}

export const pool = global._velaPgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  global._velaPgPool = pool;
}

export type UserRole = "customer" | "vendor";

export interface UserRecord {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>(
    "SELECT * FROM users WHERE email = $1 LIMIT 1",
    [email.toLowerCase().trim()]
  );
  return result.rows[0] ?? null;
}

export async function createUser(params: {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}): Promise<UserRecord> {
  const result = await pool.query<UserRecord>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.name, params.email.toLowerCase().trim(), params.passwordHash, params.role]
  );
  return result.rows[0];
}

export async function findUserById(id: number): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>(
    "SELECT * FROM users WHERE id = $1 LIMIT 1",
    [id]
  );
  return result.rows[0] ?? null;
}
