import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Screenshots go next to the repo: C:\Aswin Projects\event-management-test-run
export const SHOT_DIR =
  process.env.E2E_SHOT_DIR ?? path.resolve(__dirname, "..", "..", "..", "event-management-test-run");
const SCREENS_LOG = path.resolve(__dirname, "..", "playwright-report", "screens.jsonl");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const isLocalUrl = (u: string) => {
  try {
    const url = new URL(u);
    return !/^https?:|^wss?:/.test(url.protocol) || LOCAL_HOSTS.has(url.hostname);
  } catch {
    return true;
  }
};

type Diagnostics = { errors: string[]; blocked: Set<string> };

export const test = base.extend<{ diag: Diagnostics }>({
  diag: [
    async ({ page }, use) => {
      const diag: Diagnostics = { errors: [], blocked: new Set() };
      // Never let the app talk to anything but localhost.
      await page.route(
        (url) => !isLocalUrl(url.toString()),
        (route) => {
          diag.blocked.add(new URL(route.request().url()).host);
          return route.abort("blockedbyclient");
        }
      );
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const loc = msg.location()?.url ?? "";
        const text = msg.text();
        // Failures of requests we blocked on purpose are not app errors.
        if (/ERR_BLOCKED_BY_CLIENT|ERR_FAILED/.test(text) && (!loc || !isLocalUrl(loc))) return;
        if (/ERR_BLOCKED_BY_CLIENT/.test(text)) return;
        diag.errors.push(`console: ${text.slice(0, 300)}${loc ? ` (${loc})` : ""}`);
      });
      page.on("pageerror", (err) => diag.errors.push(`pageerror: ${err.message.slice(0, 300)}`));
      await use(diag);
    },
    { auto: true },
  ],
});
export { expect };

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 600;

/** Unique per run and project; stable across worker restarts (E2E_RUN_ID is set in global setup). */
export function runTag(testInfo: TestInfo) {
  const p = testInfo.project.name.startsWith("mobile") ? "m" : "d";
  return `${p}${process.env.E2E_RUN_ID ?? Date.now().toString(36)}`;
}

type Probe = {
  innerWidth: number;
  scrollWidth: number;
  wide: string[];
  small: string[];
};

/**
 * Per-screen checks: full-page screenshot, no console errors since the last
 * check, no horizontal overflow, and (mobile only) tap targets >= 40px.
 * Uses soft assertions so every problem on every screen is reported.
 */
export async function checkScreen(
  page: Page,
  diag: Diagnostics,
  testInfo: TestInfo,
  name: string,
  opts: { ignoreErrors?: RegExp[] } = {}
) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  const width = page.viewportSize()?.width ?? 0;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = `${width}-${name}.png`;
  await page.screenshot({ path: path.join(SHOT_DIR, file), fullPage: true, animations: "disabled" });

  const probe: Probe = await page.evaluate((mobile) => {
    const W = window.innerWidth;
    const desc = (el: Element) => {
      const h = el as HTMLElement & { value?: string; placeholder?: string };
      const t = (h.getAttribute("aria-label") || h.innerText || h.value || h.placeholder || h.getAttribute("href") || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40);
      return `${el.tagName.toLowerCase()} "${t}"`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[aria-hidden=true]");
    };
    const wide = [...document.querySelectorAll("body *")]
      .filter((e) => visible(e) && e.getBoundingClientRect().right > W + 1 && getComputedStyle(e).position !== "fixed")
      .slice(0, 6)
      .map((e) => `${desc(e)} right=${Math.round(e.getBoundingClientRect().right)}`);
    const small: string[] = [];
    if (mobile) {
      const seen = new Set<Element>();
      for (const el of document.querySelectorAll(
        'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]'
      )) {
        let t: Element = el;
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
          const l = el.closest("label");
          if (l) t = l;
        }
        if (seen.has(t)) continue;
        seen.add(t);
        if (!visible(t)) continue;
        // Stretched card links: the ::after overlay is the real tap target.
        if (t.tagName === "A" && getComputedStyle(t, "::after").position === "absolute") continue;
        // Inline text links inside running text are exempt.
        if (t.tagName === "A" && getComputedStyle(t).display === "inline") {
          const parentText = (t.parentElement?.textContent ?? "").trim().length;
          if (parentText > (t.textContent ?? "").trim().length + 3) continue;
        }
        const r = t.getBoundingClientRect();
        if (r.height < 40 || r.width < 40) small.push(`${desc(t)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return { innerWidth: W, scrollWidth: document.documentElement.scrollWidth, wide, small };
  }, isMobile(page));

  const errors = diag.errors.splice(0).filter((e) => !(opts.ignoreErrors ?? []).some((re) => re.test(e)));
  const record = {
    project: testInfo.project.name,
    test: testInfo.title,
    name,
    width,
    file,
    url: new URL(page.url()).pathname + new URL(page.url()).search,
    errors,
    overflow: probe.scrollWidth > probe.innerWidth ? `scrollWidth ${probe.scrollWidth} > innerWidth ${probe.innerWidth}` : null,
    wide: probe.wide,
    smallTaps: probe.small,
    blocked: [...diag.blocked],
  };
  fs.mkdirSync(path.dirname(SCREENS_LOG), { recursive: true });
  fs.appendFileSync(SCREENS_LOG, JSON.stringify(record) + "\n");

  expect.soft(errors, `[${name}] console errors`).toEqual([]);
  expect.soft(probe.scrollWidth, `[${name}] horizontal overflow: ${probe.wide.join("; ")}`).toBeLessThanOrEqual(probe.innerWidth);
  expect.soft(probe.small, `[${name}] tap targets under 40px`).toEqual([]);
}

export type Creds = { name: string; email: string; password: string };

export async function signUp(page: Page, role: "customer" | "vendor", creds: Creds) {
  await page.goto(role === "vendor" ? "/signup?role=vendor" : "/signup");
  await page.getByText(role === "vendor" ? "I'm a vendor" : "I'm planning an event").click();
  await page.getByLabel("Your name").fill(creds.name);
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signup"));
}

export async function signIn(page: Page, creds: Creds) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /Hi, |Account menu for/ }).click();
  await page.getByRole("menuitem", { name: /^Log ?out$/i }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
}

/**
 * TEST-ONLY: creates an admin straight in the LOCAL DB (e2e-admin-... email,
 * removed by the global cleanup) and signs in through the login page.
 * Returns the credentials. Refuses a non-localhost DATABASE_URL.
 */
export async function loginAsAdmin(page: Page, testInfo: TestInfo): Promise<Creds> {
  const url = process.env.DATABASE_URL;
  const host = (() => {
    try {
      return new URL(url ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!url || !LOCAL_HOSTS.has(host)) throw new Error("loginAsAdmin needs a localhost DATABASE_URL");
  const { default: pg } = await import("pg");
  const { default: bcrypt } = await import("bcryptjs");
  const creds: Creds = {
    name: "E2E Admin",
    email: `e2e-admin-${runTag(testInfo)}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: "e2e-admin-password-1",
  };
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')", [
      creds.name,
      creds.email,
      await bcrypt.hash(creds.password, 10),
    ]);
  } finally {
    await client.end();
  }
  await signIn(page, creds);
  return creds;
}
