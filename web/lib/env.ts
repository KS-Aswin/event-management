// Boot-time check of the server's environment (instrumentation.ts). Collects
// every problem and throws ONE error listing them, so a deploy with missing
// variables fails at startup with a clear message instead of on the first
// request. Keep it free of runtime imports so tests can load it directly.

export interface EnvProblem {
  name: string;
  problem: string;
}

const PLACEHOLDER = /your_|change_?me|placeholder/i;

export function checkServerEnv(env: NodeJS.ProcessEnv = process.env): EnvProblem[] {
  const out: EnvProblem[] = [];
  const prod = env.NODE_ENV === "production";
  const val = (k: string) => env[k]?.trim() ?? "";

  const db = val("DATABASE_URL");
  if (!db) out.push({ name: "DATABASE_URL", problem: "missing" });
  else if (!/^postgres(ql)?:\/\//i.test(db)) out.push({ name: "DATABASE_URL", problem: "must start with postgresql://" });

  const secret = val("SESSION_SECRET");
  if (!secret) out.push({ name: "SESSION_SECRET", problem: "missing" });
  else if (secret.length < 32 || PLACEHOLDER.test(secret)) {
    out.push({ name: "SESSION_SECRET", problem: "too short (min 32 chars) or still a placeholder" });
  }

  const driver = (val("STORAGE_DRIVER") || "local").toLowerCase();
  if (driver === "supabase") {
    for (const k of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
      if (!val(k) && !(k === "SUPABASE_SECRET_KEY" && val("SUPABASE_SERVICE_ROLE_KEY"))) out.push({ name: k, problem: "missing (STORAGE_DRIVER=supabase)" });
    }
  } else if (driver === "s3" || driver === "r2") {
    for (const k of ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      if (!val(k)) out.push({ name: k, problem: `missing (STORAGE_DRIVER=${driver})` });
    }
  } else if (driver === "local") {
    if (prod && (env.VERCEL || val("STORAGE_ALLOW_LOCAL") !== "1")) {
      out.push({
        name: "STORAGE_DRIVER",
        problem: env.VERCEL
          ? "is local, but Vercel's filesystem is read-only: set supabase, s3 or r2"
          : "is local in production: set supabase, s3 or r2 (or STORAGE_ALLOW_LOCAL=1 on a server with a persistent disk)",
      });
    }
  } else {
    out.push({ name: "STORAGE_DRIVER", problem: `unknown value "${driver}" (local, supabase, s3, r2)` });
  }

  if (prod && env.VERCEL) {
    const site = val("NEXT_PUBLIC_SITE_URL");
    if (site && !/^https:\/\//i.test(site)) out.push({ name: "NEXT_PUBLIC_SITE_URL", problem: "must be an https:// origin" });
  }
  return out;
}

export function assertServerEnv(env: NodeJS.ProcessEnv = process.env): void {
  const problems = checkServerEnv(env);
  if (problems.length === 0) return;
  throw new Error(
    "Vela cannot start, fix these environment variables (see docs/DEPLOY.md):\n" +
      problems.map((p) => `  - ${p.name}: ${p.problem}`).join("\n")
  );
}
