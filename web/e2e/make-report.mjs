// Builds the self-contained HTML test report from the last e2e run.
// Usage: node e2e/make-report.mjs [fixResultsDir] [outFile]
//   fixResultsDir: folder with fix-results-<key>.jsonl (optional; tracker table)
//   outFile: defaults to ../../event-management-test-report.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const fixDir = process.argv[2];
const outFile = process.argv[3] ?? path.resolve(web, "..", "..", "event-management-test-report.html");
const extra = process.env.REPORT_EXTRA ? JSON.parse(fs.readFileSync(process.env.REPORT_EXTRA, "utf8")) : {};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const strip = (s) => String(s ?? "").replace(/\x1b\[[0-9;]*m/g, "");

// ---- test results
const results = JSON.parse(fs.readFileSync(path.join(web, "playwright-report", "results.json"), "utf8"));
const tests = [];
(function walk(suite, file) {
  for (const s of suite.suites ?? []) walk(s, s.file ?? file);
  for (const spec of suite.specs ?? [])
    for (const t of spec.tests) {
      const r = t.results.at(-1) ?? {};
      tests.push({
        file: spec.file ?? file,
        title: spec.title,
        project: t.projectName,
        status: r.status ?? "skipped",
        ms: r.duration ?? 0,
        errors: (r.errors ?? []).map((e) => strip(e.message).split("\n").slice(0, 6).join("\n")),
      });
    }
})(results);
const passed = tests.filter((t) => t.status === "passed").length;
const failed = tests.filter((t) => t.status === "failed" || t.status === "timedOut").length;
const skipped = tests.length - passed - failed;

// ---- screens
const screens = fs
  .readFileSync(path.join(web, "playwright-report", "screens.jsonl"), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const byName = new Map();
for (const s of screens) {
  if (!byName.has(s.name)) byName.set(s.name, {});
  byName.get(s.name)[s.width] = s;
}
const screenNames = [...byName.keys()];
const blocked = [...new Set(screens.flatMap((s) => s.blocked))];

// ---- tracker items -> screens
const ALL = "all screens (shared shell)";
const rules = [
  [/app\/(header|footer|layout)\.tsx|globals\.css|app\/(error|loading)\.tsx/, [ALL]],
  [/app\/page\.tsx/, ["home"]],
  [/home-search|api\/suggest/, ["home", "home-typeahead"]],
  [/app\/search\//, ["search", "search-filtered", "search-empty"]],
  [/app\/vendors\/\[id\]\/(page|quote-button)/, ["vendor-profile", "quote-dialog", "quote-dialog-filled", "quote-sent"]],
  [/review-form|api\/reviews|api\/vendors\/\[id\]\/reviews/, ["vendor-profile"]],
  [/app\/not-found/, ["not-found", "vendor-not-found"]],
  [/app\/login\//, ["login", "signup"]],
  [/app\/signup\//, ["signup"]],
  [/api\/auth/, ["login", "signup"]],
  [/app\/settings|api\/account/, ["settings"]],
  [/create-listing|api\/meta/, ["create-listing", "edit-listing"]],
  [/edit-listing/, ["edit-listing"]],
  [/dashboard\/services|api\/services|api\/vendors\/\[id\]\/services/, ["dashboard-services"]],
  [/dashboard\/leads|lead-status|lead-contact|api\/quotes/, ["dashboard-leads", "dashboard-vendor-with-lead"]],
  [/lead-list/, ["dashboard-customer", "dashboard-leads"]],
  [/app\/dashboard\/page/, ["dashboard-vendor-empty", "dashboard-vendor", "dashboard-vendor-with-lead", "dashboard-customer-empty", "dashboard-customer"]],
  [/favorite/, ["search", "vendor-profile", "dashboard-customer"]],
  [/api\/vendors\/\[id\]\/quotes/, ["quote-sent", "dashboard-leads"]],
  [/api\/vendors\/route|api\/vendors\/\[id\]\/route/, ["search", "vendor-profile", "create-listing", "edit-listing"]],
  [/app\/(about|help|privacy|for-vendors)\//, null],
  [/lib\/db\.ts|db\/|lib\/search|lib\/vendor/, ["search", "vendor-profile", "home"]],
];
function screensFor(files) {
  const out = new Set();
  for (const f of files ?? []) {
    for (const [re, names] of rules) {
      const m = f.match(re);
      if (!m) continue;
      if (names) names.forEach((n) => out.add(n));
      else out.add(f.match(/app\/(about|help|privacy|for-vendors)\//)[1]);
    }
  }
  if (out.has(ALL)) return [ALL];
  return [...out];
}
const items = [];
if (fixDir) {
  for (const key of ["setup", "data", "vendor", "auth", "dashboard", "home", "shell"]) {
    const f = path.join(fixDir, `fix-results-${key}.jsonl`);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim())) {
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        r = JSON.parse(line.replace(/\\(?!["\\/bfnrtu])/g, "\\\\"));
      }
      items.push({ key, ...r, screens: screensFor(r.files) });
    }
  }
}
for (const x of extra.items ?? []) items.push({ ...x, screens: x.screens ?? screensFor(x.files) });

// ---- html
const pill = (s) =>
  `<span class="pill ${s === "passed" ? "ok" : s === "failed" || s === "timedOut" ? "bad" : "skip"}">${esc(s)}</span>`;
const issueList = (s) => {
  if (!s) return '<span class="muted">not captured</span>';
  const bits = [];
  if (s.errors.length) bits.push(`console errors: ${s.errors.length}`);
  if (s.overflow) bits.push(`overflow: ${s.overflow}`);
  if (s.smallTaps.length) bits.push(`small tap targets: ${s.smallTaps.length}`);
  return bits.length ? `<span class="bad-t">${esc(bits.join("; "))}</span>` : '<span class="ok-t">no issues</span>';
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Event Management Test Report</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d2321;--muted:#5f6b67;--line:#e3e6e4;--card:#fff;--ok:#11734b;--ok-bg:#e3f4ec;--bad:#b42318;--bad-bg:#fdecea;--skip:#7a5b00;--skip-bg:#fff4d6;--accent:#0f6e56}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121514;--fg:#e8ecea;--muted:#9aa6a1;--line:#2b3230;--card:#1a1f1d;--ok:#5ed39b;--ok-bg:#163428;--bad:#ff8a80;--bad-bg:#3a1a18;--skip:#f2c94c;--skip-bg:#3a3017;--accent:#5ed3b0}}
:root[data-theme="dark"]{--bg:#121514;--fg:#e8ecea;--muted:#9aa6a1;--line:#2b3230;--card:#1a1f1d;--ok:#5ed39b;--ok-bg:#163428;--bad:#ff8a80;--bad-bg:#3a1a18;--skip:#f2c94c;--skip-bg:#3a3017;--accent:#5ed3b0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 16px 60px}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:36px 0 12px}h3{font-size:16px;margin:0 0 8px}
.muted{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.num{font-size:28px;font-weight:650}
.ok-t{color:var(--ok)}.bad-t{color:var(--bad)}.pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12.5px;font-weight:600}
.pill.ok{background:var(--ok-bg);color:var(--ok)}.pill.bad{background:var(--bad-bg);color:var(--bad)}.pill.skip{background:var(--skip-bg);color:var(--skip)}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600;color:var(--muted);font-size:12.5px;text-transform:uppercase;letter-spacing:.03em}
tr:last-child td{border-bottom:0}pre{white-space:pre-wrap;margin:6px 0 0;font-size:12.5px;color:var(--bad)}code{font-size:13px}
.shots{display:grid;gap:18px}.shot{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.2fr);gap:14px;align-items:start}@media (max-width:700px){.pair{grid-template-columns:1fr}}
.pair figure{margin:0}.pair img{width:100%;height:auto;max-height:900px;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:8px;display:block}
figcaption{font-size:12.5px;color:var(--muted);margin-top:4px}a{color:var(--accent)}ul{padding-left:20px}
</style></head><body><main>
<h1>Event Management Test Report</h1>
<p class="muted">Vela web app (Next.js 16, local Postgres) · branch ui-fixes-aswin · Playwright ${esc(extra.playwright ?? "")} on Chromium · run ${esc(new Date(results.stats.startTime).toISOString().replace("T", " ").slice(0, 16))} UTC · ${(results.stats.duration / 1000).toFixed(0)} s</p>

<div class="cards">
<div class="card"><div class="num ${failed ? "bad-t" : "ok-t"}">${passed}/${tests.length}</div><div class="muted">e2e tests passed</div></div>
<div class="card"><div class="num ${failed ? "bad-t" : ""}">${failed}</div><div class="muted">failed</div></div>
<div class="card"><div class="num">${skipped}</div><div class="muted">skipped</div></div>
<div class="card"><div class="num">${screenNames.length}</div><div class="muted">screens × 2 widths (390, 1440)</div></div>
${(extra.checks ?? []).map((c) => `<div class="card"><div class="num ${c.ok ? "ok-t" : "bad-t"}" style="font-size:18px">${esc(c.value)}</div><div class="muted">${esc(c.label)}</div></div>`).join("")}
</div>

<p>Every screen is checked for console errors, horizontal overflow (<code>scrollWidth &lt;= innerWidth</code>) and, at 390px, tap targets of at least 40px (inline links in running text excepted). All non-localhost requests are aborted${blocked.length ? ` (blocked during this run: ${blocked.map(esc).join(", ")})` : ""}.</p>

<h2>Errors found and fixed during testing</h2>
<div class="tw"><table><thead><tr><th>Problem</th><th>Fix</th><th>Screens</th></tr></thead><tbody>
${(extra.found ?? []).map((f) => `<tr><td>${esc(f.problem)}</td><td>${esc(f.fix)}</td><td>${esc(f.screens)}</td></tr>`).join("")}
</tbody></table></div>
${(extra.notes ?? []).length ? `<h3 style="margin-top:18px">Open notes</h3><ul>${extra.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}

<h2>Test results</h2>
<div class="tw"><table><thead><tr><th>Test</th><th>Width</th><th>Result</th><th>Time</th></tr></thead><tbody>
${tests
  .map(
    (t) =>
      `<tr><td>${esc(t.title)}<div class="muted" style="font-size:12.5px">${esc(t.file)}</div>${t.errors.map((e) => `<pre>${esc(e)}</pre>`).join("")}</td><td>${esc(t.project)}</td><td>${pill(t.status)}</td><td>${(t.ms / 1000).toFixed(1)} s</td></tr>`
  )
  .join("")}
</tbody></table></div>

<h2>Screen checks</h2>
<div class="tw"><table><thead><tr><th>Screen</th><th>URL</th><th>390px</th><th>1440px</th></tr></thead><tbody>
${screenNames
  .map((n) => {
    const s = byName.get(n);
    const any = s[390] ?? s[1440];
    return `<tr><td><a href="#shot-${esc(n)}">${esc(n)}</a></td><td><code>${esc(any.url)}</code></td><td>${issueList(s[390])}</td><td>${issueList(s[1440])}</td></tr>`;
  })
  .join("")}
</tbody></table></div>

<h2>Tracker items fixed in stage 4 and the screens they affect</h2>
<div class="tw"><table><thead><tr><th>Item</th><th>Batch</th><th>Status</th><th>Change</th><th>Screens</th></tr></thead><tbody>
${items
  .map(
    (i) =>
      `<tr><td><b>${esc(i.id)}</b></td><td>${esc(i.key)}</td><td>${esc(i.status)}</td><td>${esc(i.summary)}</td><td>${
        i.screens.length
          ? i.screens.map((n) => (byName.has(n) ? `<a href="#shot-${esc(n)}">${esc(n)}</a>` : esc(n))).join(", ")
          : '<span class="muted">no screen (API / data / docs)</span>'
      }</td></tr>`
  )
  .join("")}
</tbody></table></div>

<h2>Screenshots</h2>
<div class="shots">
${screenNames
  .map((n) => {
    const s = byName.get(n);
    const fig = (w) =>
      s[w]
        ? `<figure><img loading="lazy" src="event-management-test-run/${esc(s[w].file)}" alt="${esc(n)} at ${w}px"><figcaption>${w}px · <a href="event-management-test-run/${esc(s[w].file)}">full size</a></figcaption></figure>`
        : `<figure class="muted">not captured at ${w}px</figure>`;
    return `<section class="shot" id="shot-${esc(n)}"><h3>${esc(n)} <span class="muted" style="font-weight:400">${esc((s[390] ?? s[1440]).url)}</span></h3><div class="pair">${fig(390)}${fig(1440)}</div></section>`;
  })
  .join("")}
</div>
</main></body></html>`;

fs.writeFileSync(outFile, html);
console.log(`Report: ${outFile} (${passed}/${tests.length} passed, ${screenNames.length} screens, ${items.length} tracker items)`);
