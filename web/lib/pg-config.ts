// Shared node-postgres settings for the app (lib/db.ts) and the scripts
// (db/migrate.mjs, db/seed.mjs, scripts/admin-create.mjs). No imports, so the
// .mjs scripts can load it with Node's type stripping.
//
// - SSL: on for any non-local host (Supabase, Neon, RDS...). Supabase signs
//   its certificates with its own CA, which isn't in Node's trust store, so by
//   default the connection is encrypted without verifying the chain. Set
//   DATABASE_SSL_CA to the PEM text of the provider's CA (Supabase dashboard >
//   Database > SSL) to verify it, or DATABASE_SSL=disable to turn SSL off.
// - Serverless pooler: works with PgBouncer/Supavisor in transaction mode
//   (port 6543). Only unnamed prepared statements, no session state (SET,
//   LISTEN, session advisory locks) and a small pool per function instance.

export interface PgSettings {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  /** Lets an idle serverless instance exit instead of holding connections. */
  allowExitOnIdle: boolean;
}

export function isLocalDatabase(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  } catch {
    return false;
  }
}

/** True for a transaction-mode pooler (Supabase/Supavisor uses port 6543; PGBOUNCER=1 forces it). */
export function isTransactionPooler(connectionString: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PGBOUNCER === "1" || env.PGBOUNCER === "true") return true;
  try {
    const u = new URL(connectionString);
    return u.port === "6543" || u.searchParams.get("pgbouncer") === "true";
  } catch {
    return false;
  }
}

export function pgSettings(
  connectionString: string,
  opts: { serverless?: boolean; env?: NodeJS.ProcessEnv } = {}
): PgSettings {
  const env = opts.env ?? process.env;
  const url = new URL(connectionString);
  // sslmode / pgbouncer in the URL would override the ssl object below (pg
  // merges URL params last), so they are read here and removed.
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("pgbouncer");
  const mode = (env.DATABASE_SSL || sslmode || "").toLowerCase();
  const local = isLocalDatabase(connectionString);
  let ssl: PgSettings["ssl"];
  if (mode === "disable" || (local && mode !== "require" && mode !== "verify-full")) ssl = false;
  else if (env.DATABASE_SSL_CA) ssl = { rejectUnauthorized: true, ca: env.DATABASE_SSL_CA.replace(/\n/g, "\n") };
  else ssl = { rejectUnauthorized: mode === "verify-full" };

  const serverless = opts.serverless ?? !!(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);
  const max = Number(env.DB_POOL_MAX) || (serverless ? 3 : 10);
  return {
    connectionString: url.toString(),
    ssl,
    max,
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    // Remote poolers can take a moment on a cold start.
    connectionTimeoutMillis: local ? 5_000 : 10_000,
    allowExitOnIdle: serverless,
  };
}
