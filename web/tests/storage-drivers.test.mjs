// Unit tests for the remote storage drivers (P3-1): Supabase Storage (HTTP
// API) against an in-memory fake, the S3 SigV4 signer against AWS's published
// examples, the S3 adapter against a fake MinIO, the boot env check and the
// local driver's production guard. No network, server or database:
//
//   node tests/storage-drivers.test.mjs   (part of npm run test:storage)

import { registerHooks } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, next) {
    let base = null;
    if (specifier.startsWith("@/")) base = path.join(WEB, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) {
      base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base && !path.extname(base)) {
      for (const cand of [`${base}.ts`, path.join(base, "index.ts")]) {
        if (existsSync(cand)) return next(pathToFileURL(cand).href, context);
      }
    }
    return next(specifier, context);
  },
});

const load = (rel) => import(pathToFileURL(path.join(WEB, rel)).href);
const { SupabaseStorageAdapter, S3StorageAdapter, LocalDiskAdapter } = await load("lib/storage/index.ts");
const { signHeaders, presignQuery } = await load("lib/storage/s3.ts");
const { checkServerEnv } = await load("lib/env.ts");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err?.stack?.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---- Supabase ---------------------------------------------------------------

// A fake Supabase Storage API: objects per bucket in memory, with the status
// codes the real one returns (a missing object is 400 with statusCode "404";
// checked against the live API on 2026-11-06).
function fakeSupabase() {
  const buckets = { "vela-media": new Map(), "vela-media-private": new Map() };
  const calls = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const missing = () => json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    calls.push({ method, path: u.pathname, auth: headers.get("authorization") });
    if (headers.get("apikey") !== "sb_secret_test") return json(401, { message: "bad key" });
    const p = u.pathname.replace(/^\/storage\/v1/, "");
    let m;
    if ((m = /^\/object\/list\/([^/]+)$/.exec(p))) {
      const { prefix } = JSON.parse(init.body);
      const seen = new Map();
      for (const k of buckets[m[1]].keys()) {
        if (!k.startsWith(`${prefix}/`)) continue;
        const [head, ...more] = k.slice(prefix.length + 1).split("/");
        seen.set(head, more.length ? null : "id");
      }
      return json(200, [...seen].map(([name, id]) => ({ name, id })));
    }
    if ((m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(p))) return json(200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=t` });
    if ((m = /^\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(p))) return json(200, { url: `/object/upload/sign/${m[1]}/${m[2]}?token=u` });
    if ((m = /^\/object\/([^/]+)$/.exec(p)) && method === "DELETE") {
      for (const k of JSON.parse(init.body).prefixes) buckets[m[1]].delete(k);
      return json(200, []);
    }
    if ((m = /^\/object\/([^/]+)\/(.+)$/.exec(p))) {
      const [, b, key] = m;
      const store = buckets[b];
      if (method === "POST") {
        store.set(key, { body: Buffer.from(init.body), type: headers.get("content-type"), cache: headers.get("cache-control") });
        return json(200, { Key: `${b}/${key}` });
      }
      const o = store.get(key);
      if (!o) return method === "HEAD" ? new Response(null, { status: 400 }) : missing();
      const range = /bytes=(\d+)-(\d+)/.exec(headers.get("range") ?? "");
      const body = range ? o.body.subarray(Number(range[1]), Number(range[2]) + 1) : o.body;
      const h = { "content-type": o.type, "content-length": String(body.length) };
      if (range) h["content-range"] = `bytes ${range[1]}-${range[2]}/${o.body.length}`;
      return new Response(method === "HEAD" ? null : body, { status: range ? 206 : 200, headers: h });
    }
    return json(404, { message: `unhandled ${method} ${p}` });
  };
  return { buckets, calls, fetchImpl };
}

console.log("supabase driver");
const fake = fakeSupabase();
const sb = new SupabaseStorageAdapter({
  url: "https://proj.supabase.co/",
  secretKey: "sb_secret_test",
  bucket: "vela-media",
  privateBucket: "vela-media-private",
  fetch: fake.fetchImpl,
});

await test("put/head/get/range round-trip with the secret key", async () => {
  const key = "vendors/7/11111111-1111-1111-1111-111111111111/card.webp";
  const r = await sb.put(key, Buffer.from("0123456789"), { contentType: "image/webp" });
  assert.deepEqual(r, { key, contentType: "image/webp", bytes: 10 });
  assert.equal(fake.buckets["vela-media"].get(key).cache, "max-age=31536000");
  assert.equal(fake.calls.at(-1).auth, "Bearer sb_secret_test");
  assert.deepEqual(await sb.head(key), { contentType: "image/webp", bytes: 10 });
  const got = await sb.get(key);
  assert.equal(Buffer.from(got.body).toString(), "0123456789");
  const part = await sb.get(key, { range: { start: 2, end: 4 } });
  assert.equal(Buffer.from(part.body).toString(), "234");
  assert.equal(part.bytes, 10, "bytes is the whole object's size");
});

await test("missing objects are null, deleting one is not an error", async () => {
  assert.equal(await sb.head("vendors/7/none.webp"), null);
  assert.equal(await sb.get("vendors/7/none.webp"), null);
  await sb.delete("vendors/7/none.webp");
});

await test("private/ keys go to the private bucket and never get a public URL", async () => {
  const key = "private/vendor-docs/7/doc.pdf";
  await sb.put(key, Buffer.from("%PDF-1.4"), { contentType: "application/pdf" });
  assert.ok(fake.buckets["vela-media-private"].has(key));
  assert.ok(!fake.buckets["vela-media"].has(key));
  assert.equal(fake.buckets["vela-media-private"].get(key).cache, "no-store");
  assert.equal(sb.directUrl(key), null);
  assert.equal(
    await sb.signedUrl(key, 60),
    "https://proj.supabase.co/storage/v1/object/sign/vela-media-private/private/vendor-docs/7/doc.pdf?token=t"
  );
});

await test("URLs: app path, public CDN URL, signed upload without the secret", async () => {
  const key = "vendors/7/abc/full.webp";
  assert.equal(sb.publicUrl(key), "/media/vendors/7/abc/full.webp");
  assert.equal(sb.directUrl(key), "https://proj.supabase.co/storage/v1/object/public/vela-media/vendors/7/abc/full.webp");
  const up = await sb.createUploadUrl("vendors/7/abc/upload.bin", "image/jpeg", 1000);
  assert.equal(up.method, "PUT");
  assert.equal(up.url, "https://proj.supabase.co/storage/v1/object/upload/sign/vela-media/vendors/7/abc/upload.bin?token=u");
  assert.equal(up.headers["Content-Type"], "image/jpeg");
  assert.ok(!JSON.stringify(up).includes("sb_secret_test"), "the secret never reaches the browser");
  assert.match(await sb.signedUrl("vendors/7/abc/upload.bin", 300, { download: "" }), /token=t&download=$/);
  assert.throws(() => sb.publicUrl("../etc/passwd"), /Invalid storage key/);
});

await test("deletePrefix removes nested objects under the prefix only", async () => {
  for (const k of ["vendors/9/u1/thumb.webp", "vendors/9/u1/card.webp", "vendors/9/u1/sub/x.webp", "vendors/9/u2/thumb.webp"]) {
    await sb.put(k, Buffer.from("x"), { contentType: "image/webp" });
  }
  assert.deepEqual(await sb.list("vendors/9/u1"), ["vendors/9/u1/card.webp", "vendors/9/u1/sub/x.webp", "vendors/9/u1/thumb.webp"]);
  await sb.deletePrefix("vendors/9/u1/");
  assert.deepEqual(await sb.list("vendors/9"), ["vendors/9/u2/thumb.webp"]);
});

await test("API errors surface with the status", async () => {
  const bad = new SupabaseStorageAdapter({ url: "https://proj.supabase.co", secretKey: "wrong", bucket: "vela-media", privateBucket: "p", fetch: fake.fetchImpl });
  await assert.rejects(bad.put("vendors/1/a.webp", Buffer.from("x"), { contentType: "image/webp" }), /Storage upload failed \(401\)/);
});

// ---- S3 ---------------------------------------------------------------------

console.log("s3 driver");
// AWS's published Signature V4 examples (S3 API reference, "Authenticating
// requests"), so the signer is checked against known-good output.
const AWS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  now: new Date("2013-05-24T00:00:00Z"),
};

await test("SigV4 header signature matches the AWS GET example", () => {
  const h = signHeaders({
    ...AWS,
    method: "GET",
    path: "/test.txt",
    query: {},
    headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  });
  assert.match(
    h.Authorization,
    /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/
  );
});

await test("presigned URL matches the AWS query-string example", () => {
  const qs = presignQuery({ ...AWS, method: "GET", path: "/test.txt", query: {}, host: "examplebucket.s3.amazonaws.com", expires: 86400 });
  assert.match(qs, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

await test("adapter talks path-style to an S3-compatible endpoint (fake MinIO)", async () => {
  const store = new Map();
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    seen.push({ method, url: u.href, auth: headers.get("authorization") ?? "" });
    const [, bucket, ...rest] = u.pathname.split("/");
    const key = rest.join("/");
    if (method === "GET" && !key) {
      const prefix = u.searchParams.get("prefix");
      const keys = [...store.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}`)).map((k) => k.slice(bucket.length + 1));
      return new Response(
        `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`
      );
    }
    const id = `${bucket}/${key}`;
    if (method === "PUT") {
      store.set(id, { body: Buffer.from(init.body), type: headers.get("content-type") });
      return new Response("", { status: 200 });
    }
    if (method === "DELETE") {
      store.delete(id);
      return new Response(null, { status: 204 });
    }
    const o = store.get(id);
    if (!o) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    return new Response(method === "HEAD" ? null : o.body, {
      headers: { "content-type": o.type, "content-length": String(o.body.length) },
    });
  };
  const s3 = new S3StorageAdapter({
    driver: "r2",
    endpoint: "http://127.0.0.1:9000",
    region: "auto",
    accessKeyId: "minio",
    secretAccessKey: "minio-secret",
    bucket: "vela-media",
    privateBucket: "vela-private",
    publicBaseUrl: "https://media.example.com",
    fetch: fetchImpl,
  });
  await s3.put("vendors/3/u/full.webp", Buffer.from("abc"), { contentType: "image/webp" });
  await s3.put("vendors/3/u/thumb.webp", Buffer.from("a"), { contentType: "image/webp" });
  await s3.put("private/vendor-docs/3/d.pdf", Buffer.from("%PDF"), { contentType: "application/pdf" });
  assert.equal(seen[0].url, "http://127.0.0.1:9000/vela-media/vendors/3/u/full.webp");
  assert.match(
    seen[0].auth,
    /^AWS4-HMAC-SHA256 Credential=minio\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
  );
  assert.ok(store.has("vela-private/private/vendor-docs/3/d.pdf"));
  assert.deepEqual(await s3.head("vendors/3/u/full.webp"), { contentType: "image/webp", bytes: 3 });
  assert.equal(await s3.head("vendors/3/u/none.webp"), null);
  assert.equal(await s3.get("vendors/3/u/none.webp"), null);
  assert.equal(Buffer.from((await s3.get("vendors/3/u/full.webp")).body).toString(), "abc");
  assert.equal(s3.directUrl("vendors/3/u/full.webp"), "https://media.example.com/vendors/3/u/full.webp");
  assert.equal(s3.directUrl("private/vendor-docs/3/d.pdf"), null);
  assert.match(
    await s3.signedUrl("private/vendor-docs/3/d.pdf", 60),
    /^http:\/\/127\.0\.0\.1:9000\/vela-private\/private\/vendor-docs\/3\/d\.pdf\?.*X-Amz-Expires=60.*X-Amz-Signature=[0-9a-f]{64}$/
  );
  const up = await s3.createUploadUrl("vendors/3/u/upload.bin", "image/png", 10);
  assert.equal(up.method, "PUT");
  assert.ok(!up.url.includes("minio-secret"));
  await s3.deletePrefix("vendors/3/u");
  assert.deepEqual(await s3.list("vendors/3"), []);
  assert.ok(store.has("vela-private/private/vendor-docs/3/d.pdf"), "deletePrefix stays inside the prefix");
});

// ---- Boot checks --------------------------------------------------------------

console.log("boot checks");
await test("env check lists every missing variable at once", () => {
  const problems = checkServerEnv({ NODE_ENV: "production", VERCEL: "1", STORAGE_DRIVER: "supabase" });
  assert.deepEqual(problems.map((p) => p.name), ["DATABASE_URL", "SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  const ok = { DATABASE_URL: "postgresql://x", SESSION_SECRET: "s".repeat(40) };
  assert.match(checkServerEnv({ ...ok, NODE_ENV: "production", VERCEL: "1" })[0].problem, /read-only/);
  assert.equal(checkServerEnv({ ...ok, NODE_ENV: "production", STORAGE_ALLOW_LOCAL: "1" }).length, 0);
  assert.deepEqual(checkServerEnv({ ...ok, NODE_ENV: "development" }), []);
  assert.match(checkServerEnv({ ...ok, SESSION_SECRET: "CHANGE_ME" })[0].problem, /placeholder/);
});

await test("local driver refuses to write in production", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "vela-drivers-"));
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      new LocalDiskAdapter(root).put("x/y.webp", Buffer.from("x"), { contentType: "image/webp" }),
      /does not write in production/
    );
  } finally {
    process.env.NODE_ENV = env;
    rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
