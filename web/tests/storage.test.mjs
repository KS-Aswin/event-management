// Unit tests for the storage adapter, the /media route, the video-link
// parser, magic-byte sniffing and image processing (P0-4 / P0-5 / P0-6).
// No server and no database needed:
//
//   node tests/storage.test.mjs
//
// Loads the TypeScript sources directly (Node >= 22.18 strips types). A tiny
// resolve hook maps "@/..." and extensionless relative imports to .ts files.

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
      for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (existsSync(cand)) return next(pathToFileURL(cand).href, context);
      }
    }
    return next(specifier, context);
  },
});

const ROOT = mkdtempSync(path.join(tmpdir(), "vela-storage-test-"));
process.env.UPLOADS_DIR = ROOT;
delete process.env.STORAGE_DRIVER;

const storageMod = await import(pathToFileURL(path.join(WEB, "lib/storage/index.ts")).href);
const { getStorage, LocalDiskAdapter, assertSafeKey, isPrivateKey, parseStorageDriver } = storageMod;
const { parseVideoLink } = await import(pathToFileURL(path.join(WEB, "lib/media/video-link.ts")).href);
const { sniffType } = await import(pathToFileURL(path.join(WEB, "lib/media/magic.ts")).href);

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

async function bodyBytes(body) {
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(await new Response(body).arrayBuffer());
}

console.log("storage adapter");

await test("put -> head -> get -> publicUrl -> delete round-trip", async () => {
  const s = getStorage();
  assert.equal(s.driver, "local");
  const key = "vendors/1/abc-123/card.webp";
  const data = Buffer.from("hello world");
  const stored = await s.put(key, data, { contentType: "image/webp" });
  assert.deepEqual(stored, { key, contentType: "image/webp", bytes: 11 });
  assert.ok(existsSync(path.join(ROOT, "vendors", "1", "abc-123", "card.webp")));
  assert.deepEqual(await s.head(key), { contentType: "image/webp", bytes: 11 });
  const got = await s.get(key);
  assert.equal((await bodyBytes(got.body)).toString(), "hello world");
  assert.equal(got.contentType, "image/webp");
  assert.equal(s.publicUrl(key), "/media/vendors/1/abc-123/card.webp");
  await s.delete(key);
  assert.equal(await s.get(key), null);
  await s.delete(key); // idempotent
});

await test("range read returns only the requested bytes", async () => {
  const s = getStorage();
  const key = "vendors/1/vid/video.mp4";
  await s.put(key, Buffer.from("0123456789"), { contentType: "video/mp4" });
  const got = await s.get(key, { range: { start: 2, end: 5 } });
  assert.equal((await bodyBytes(got.body)).toString(), "2345");
  assert.equal(got.bytes, 10);
});

await test("deletePrefix removes every variant of an asset", async () => {
  const s = getStorage();
  for (const v of ["thumb", "card", "full"]) {
    await s.put(`vendors/2/u1/${v}.webp`, Buffer.from(v), { contentType: "image/webp" });
  }
  await s.put("vendors/2/u2/full.webp", Buffer.from("keep"), { contentType: "image/webp" });
  await s.deletePrefix("vendors/2/u1");
  assert.equal(await s.head("vendors/2/u1/full.webp"), null);
  assert.ok(await s.head("vendors/2/u2/full.webp"));
  await s.deletePrefix("vendors/2/u1"); // idempotent
});

await test("unsafe keys are rejected", () => {
  for (const bad of ["../x", "a/../b", "/abs", "a//b", "a\\b", "a/./b", "", "a/b\0c", ".hidden", "C:/x"]) {
    assert.throws(() => assertSafeKey(bad), `${JSON.stringify(bad)} should be rejected`);
  }
  assert.equal(assertSafeKey("vendors/9/0f3e-uuid/full.webp"), "vendors/9/0f3e-uuid/full.webp");
  const local = new LocalDiskAdapter(ROOT);
  assert.throws(() => local.resolvePath("../../etc/passwd"));
});

await test("private/ keys are detected", () => {
  assert.equal(isPrivateKey("private/vendors/1/docs/x.pdf"), true);
  assert.equal(isPrivateKey("vendors/1/private/x.webp"), false);
});

await test("unknown STORAGE_DRIVER fails fast with a clear error", () => {
  assert.throws(() => parseStorageDriver("dropbox"), /Unknown STORAGE_DRIVER "dropbox"/);
  assert.throws(() => getStorage("dropbox"), /Unknown STORAGE_DRIVER/);
  assert.throws(() => getStorage("s3"), /not implemented yet/);
  assert.equal(parseStorageDriver(undefined), "local");
  assert.equal(parseStorageDriver(" Local "), "local");
});

console.log("/media route");

const route = await import(pathToFileURL(path.join(WEB, "app/media/[...key]/route.ts")).href);
const call = (segments, headers = {}) =>
  route.GET(new Request(`http://localhost/media/${segments.join("/")}`, { headers }), {
    params: Promise.resolve({ key: segments }),
  });

await test("serves a file with type and immutable caching", async () => {
  await getStorage().put("vendors/3/a1/full.webp", Buffer.from("WEBPDATA"), { contentType: "image/webp" });
  const res = await call(["vendors", "3", "a1", "full.webp"]);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.match(res.headers.get("cache-control"), /immutable/);
  assert.equal(await res.text(), "WEBPDATA");
});

await test("Range request returns 206 with the correct bytes", async () => {
  await getStorage().put("vendors/3/v1/video.mp4", Buffer.from("abcdefghijklmnopqrstuvwxyz"), { contentType: "video/mp4" });
  let res = await call(["vendors", "3", "v1", "video.mp4"], { range: "bytes=3-7" });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 3-7/26");
  assert.equal(res.headers.get("content-length"), "5");
  assert.equal(await res.text(), "defgh");
  res = await call(["vendors", "3", "v1", "video.mp4"], { range: "bytes=-3" });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), "xyz");
  res = await call(["vendors", "3", "v1", "video.mp4"], { range: "bytes=20-" });
  assert.equal(await res.text(), "uvwxyz");
  res = await call(["vendors", "3", "v1", "video.mp4"], { range: "bytes=99-100" });
  assert.equal(res.status, 416);
});

await test("traversal (..%2f..) returns 400", async () => {
  for (const segs of [["..%2f.."], [".."], ["vendors", "..", "x"], ["..%2F..%2Fetc%2Fpasswd"], ["a%5c..%5cb"]]) {
    const res = await call(segs);
    assert.equal(res.status, 400, `${segs.join("/")} -> ${res.status}`);
  }
});

await test("private/ keys return 404", async () => {
  await getStorage().put("private/vendors/3/docs/gst.pdf", Buffer.from("%PDF-1.4"), { contentType: "application/pdf" });
  const res = await call(["private", "vendors", "3", "docs", "gst.pdf"]);
  assert.equal(res.status, 404);
});

await test("missing file returns 404", async () => {
  const res = await call(["vendors", "3", "nope", "full.webp"]);
  assert.equal(res.status, 404);
});

console.log("video link parser");

await test("supported links parse", () => {
  const cases = [
    ["https://youtu.be/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s", "youtube", "dQw4w9WgXcQ"],
    ["youtube.com/shorts/abcdefghijk", "youtube", "abcdefghijk"],
    ["https://m.youtube.com/watch?v=abcdefghijk", "youtube", "abcdefghijk"],
    ["https://www.instagram.com/reel/C1a2B3c4D5e/", "instagram", "C1a2B3c4D5e"],
    ["https://instagram.com/p/C1a2B3c4D5e", "instagram", "C1a2B3c4D5e"],
    ["https://vimeo.com/76979871", "vimeo", "76979871"],
    ["https://player.vimeo.com/video/76979871", "vimeo", "76979871"],
  ];
  for (const [url, provider, id] of cases) {
    const p = parseVideoLink(url);
    assert.ok(p, `${url} should parse`);
    assert.equal(p.provider, provider, url);
    assert.equal(p.id, id, url);
  }
  assert.equal(parseVideoLink("https://youtu.be/dQw4w9WgXcQ").thumbnailUrl, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  assert.equal(parseVideoLink("https://instagram.com/reel/C1a2B3c4D5e").thumbnailUrl, null);
});

await test("unsupported links are rejected", () => {
  for (const url of [
    "https://example.com/video",
    "https://youtube.com/watch?v=short",
    "https://youtube.com/channel/abc",
    "https://instagram.com/someuser",
    "https://vimeo.com/channels/staffpicks",
    "javascript:alert(1)",
    "ftp://youtu.be/dQw4w9WgXcQ",
    "https://evil.com/youtu.be/dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "",
    null,
  ]) {
    assert.equal(parseVideoLink(url), null, `${url} should be rejected`);
  }
});

console.log("magic bytes");

await test("sniffType recognises accepted and rejected types", () => {
  const pad = (b) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);
  assert.equal(sniffType(pad([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffType(pad(Buffer.from("RIFF\0\0\0\0WEBP"))), "image/webp");
  assert.equal(sniffType(pad(Buffer.from("%PDF-1.7"))), "application/pdf");
  assert.equal(sniffType(pad(Buffer.from("\0\0\0\x18ftypisom"))), "video/mp4");
  assert.equal(sniffType(pad(Buffer.from("\0\0\0\x18ftypheic"))), "image/heic");
  assert.equal(sniffType(pad(Buffer.from("<html>"))), "unknown");
});

console.log("image processing");

let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.log("  skip sharp not installed");
}
if (sharp) {
  const { processImage } = await import(pathToFileURL(path.join(WEB, "lib/media/image.ts")).href);
  await test("variants are WebP, sized, auto-rotated and carry no EXIF", async () => {
    // 1200x800 JPEG with EXIF orientation 6 (rotate 90) and metadata.
    const input = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#c0392b" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret-gps-owner" } } })
      .toBuffer();
    const inMeta = await sharp(input).metadata();
    assert.ok(inMeta.exif, "fixture should have EXIF");
    const out = await processImage(input, "gallery");
    assert.equal(out.fallback, false);
    assert.deepEqual(out.variants.map((v) => v.name), ["thumb", "card", "full"]);
    assert.equal(out.width, 800); // oriented
    assert.equal(out.height, 1200);
    for (const v of out.variants) {
      const m = await sharp(v.body).metadata();
      assert.equal(m.format, "webp");
      assert.equal(m.exif, undefined, `${v.name} must have no EXIF`);
      assert.ok(!m.orientation || m.orientation === 1);
      assert.ok(m.height > m.width, `${v.name} should be portrait after auto-rotate`);
    }
    assert.equal(out.variants[0].width, 320);
    assert.equal(out.variants[1].width, 800);
    assert.equal(out.variants[2].height, 1200); // not enlarged past the original
    assert.match(out.placeholderColor, /^#[0-9a-f]{6}$/);
  });
  await test("logo is cropped square, cover to 16:9", async () => {
    const input = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#123456" } }).png().toBuffer();
    const logo = await processImage(input, "logo");
    assert.deepEqual(logo.variants.map((v) => [v.width, v.height]), [[96, 96], [256, 256], [512, 512]]);
    const cover = await processImage(input, "cover");
    assert.deepEqual(cover.variants.map((v) => [v.width, v.height]), [[320, 180], [800, 450], [1920, 1080]]);
  });
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
