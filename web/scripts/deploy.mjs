// Deploys Vela to Vercel non-interactively from an env file (docs/DEPLOY.md).
//
//   npm run deploy                 # everything below, production
//   npm run deploy -- --dry-run    # check the env file and print the plan only
//   npm run deploy -- --skip-migrate --skip-env --skip-storage
//   npm run deploy -- --env-file .env.other.local
//
// Steps:
//   1. read web/.env.deploy.local and check it (same rules as the app's boot
//      check, lib/env.ts), so a deploy never goes out with a missing variable;
//   2. create the storage buckets if missing (STORAGE_DRIVER=supabase);
//   3. apply database migrations (db/migrate.mjs, session-mode URL if set);
//   4. link the Vercel project (first run only: .vercel/project.json);
//   5. push every runtime variable to Vercel (production) with `vercel env`;
//      values go through stdin, never the command line;
//   6. `vercel deploy --prod` (Vercel builds it) and print the URL.
//
// Needs the Vercel CLI logged in (`npx vercel login`) or VERCEL_TOKEN in the
// env file. Optional: VERCEL_PROJECT (default "vela"), VERCEL_SCOPE (team slug).

import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts") && !path.extname(specifier)) {
      const cand = path.resolve(path.dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`);
      if (existsSync(cand)) return next(pathToFileURL(cand).href, context);
    }
    return next(specifier, context);
  },
});

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const dryRun = flag("--dry-run");
const envFile = path.resolve(WEB, opt("--env-file", ".env.deploy.local"));

// Used by this script or the CLI only; never pushed to Vercel.
const DEPLOY_ONLY = new Set(["DATABASE_URL_SESSION", "VERCEL_PROJECT", "VERCEL_SCOPE", "VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]);

const say = (m) => console.log(m);
const die = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

if (!existsSync(envFile)) die(`${path.relative(WEB, envFile)} not found. Copy .env.deploy.example to .env.deploy.local and fill it in.`);
const vars = parseEnv(readFileSync(envFile, "utf8"));
for (const [k, v] of Object.entries(vars)) if (!v.trim()) delete vars[k];

// 1. Check
const { checkServerEnv } = await import(pathToFileURL(path.join(WEB, "lib/env.ts")).href);
const problems = checkServerEnv({ ...vars, NODE_ENV: "production", VERCEL: "1" });
if (problems.length) die(`Fix ${path.basename(envFile)} first:\n${problems.map((p) => `  - ${p.name}: ${p.problem}`).join("\n")}`);
const runtime = Object.keys(vars).filter((k) => !DEPLOY_ONLY.has(k)).sort();
say(`✓ ${path.basename(envFile)}: ${runtime.length} runtime variables (${runtime.join(", ")})`);
if (!vars.NEXT_PUBLIC_SITE_URL) {
  say("  note: NEXT_PUBLIC_SITE_URL is not set, so links, robots.txt and the sitemap use the Vercel production domain.");
}

const project = vars.VERCEL_PROJECT || "vela";
const common = [
  ...(vars.VERCEL_SCOPE ? ["--scope", vars.VERCEL_SCOPE] : []),
  ...(vars.VERCEL_TOKEN ? ["--token", vars.VERCEL_TOKEN] : []),
];
const isWin = process.platform === "win32";

/** Runs the Vercel CLI. `input` goes to stdin. Never echoes the token. */
function vercel(cliArgs, { input, allowFail = false, capture = false } = {}) {
  const shown = cliArgs.join(" ");
  if (dryRun) {
    say(`  [dry-run] vercel ${shown}`);
    return { status: 0, stdout: "" };
  }
  const r = spawnSync(isWin ? "npx.cmd" : "npx", ["--yes", "vercel", ...cliArgs, ...common], {
    cwd: WEB,
    input,
    encoding: "utf8",
    shell: isWin,
    stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", "pipe"],
  });
  if (r.status !== 0 && !allowFail) die(`vercel ${shown} failed:\n${(r.stderr || "").trim()}`);
  return r;
}

// 2. Storage buckets
if (!flag("--skip-storage") && (vars.STORAGE_DRIVER || "").toLowerCase() === "supabase") {
  if (dryRun) say("  [dry-run] ensure Supabase buckets");
  else {
    const { SupabaseStorageAdapter, supabaseConfigFromEnv } = await import(pathToFileURL(path.join(WEB, "lib/storage/supabase.ts")).href);
    const notes = await new SupabaseStorageAdapter(supabaseConfigFromEnv(vars)).ensureBuckets();
    say(`✓ storage buckets: ${notes.join(", ")}`);
  }
}

// 3. Migrations
if (!flag("--skip-migrate")) {
  if (dryRun) say("  [dry-run] node db/migrate.mjs");
  else {
    const r = spawnSync(process.execPath, [path.join(WEB, "db/migrate.mjs")], {
      cwd: WEB,
      env: { ...process.env, ...vars },
      stdio: "inherit",
    });
    if (r.status !== 0) die("migrations failed; nothing was deployed.");
  }
}

// 4. Link
if (!existsSync(path.join(WEB, ".vercel", "project.json"))) {
  vercel(["link", "--yes", "--project", project]);
}
say(`✓ Vercel project: ${project}`);

// 5. Env vars (production). rm + add works on every CLI version.
if (!flag("--skip-env")) {
  for (const k of runtime) {
    vercel(["env", "rm", k, "production", "--yes"], { allowFail: true, capture: true });
    vercel(["env", "add", k, "production"], { input: vars[k], capture: true });
  }
  say(`✓ pushed ${runtime.length} variables to Vercel (production)`);
}

// 6. Deploy
const out = vercel(["deploy", "--prod", "--yes"], { capture: true });
// Newer CLIs print JSON-ish output ("url": "https://…",), so match the URL itself.
const url = (out.stdout || "").match(/https:\/\/[^\s"',]+/g)?.pop();
say(dryRun ? "✓ dry run finished; nothing was changed." : `✓ deployed: ${url ?? "(see the Vercel dashboard)"}`);
