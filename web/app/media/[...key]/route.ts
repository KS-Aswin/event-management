import { currentStorageDriver, getStorage, isPrivateKey, isSafeKey } from "@/lib/storage";
import { pool } from "@/lib/db";
import { getLiveSession } from "@/app/api/_lib/auth";

// Serves stored media (docs/PRODUCT_PLAN.md 4.4). Local driver:
// correct Content-Type, immutable caching (keys are content-unique),
// HTTP Range for MP4 seeking, traversal -> 400, private/ -> 404, and media
// that isn't approved yet -> 404 for everyone but its vendor and admins.
// Remote drivers get the same access rules, then a redirect (see serve()).

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string[] }> };

function plain(status: number, message: string, extra?: Record<string, string>) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

/** Decodes the segments once more and rejects anything that isn't a clean key. */
function keyFromSegments(segments: string[]): string | null {
  const parts: string[] = [];
  for (const raw of segments) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    // "..%2f.." arrives as one segment containing "/" (or "\"): reject, never split.
    if (seg.includes("/") || seg.includes("\\") || seg === "." || seg === "..") return null;
    parts.push(seg);
  }
  const key = parts.join("/");
  return isSafeKey(key) ? key : null;
}

const ASSET_KEY = /^(vendors\/\d+\/[0-9a-f-]{36})\/([^/]+)$/i;

/**
 * Who may see this key. Approved media of a vendor upload is public; media
 * that is still uploading, pending review, rejected or hidden (and every raw
 * upload.bin) is only served to the owning vendor or an admin, uncached.
 * Keys outside vendors/<id>/<uuid>/ (none today) stay public.
 */
type Access = { access: "public" | "private" | "deny"; driver: string | null };

async function accessFor(key: string): Promise<Access> {
  const m = ASSET_KEY.exec(key);
  if (!m) return { access: "public", driver: null };
  const [, base, file] = m;
  const { rows } = await pool.query<{ status: string; owner_id: number | null; storage_driver: string | null }>(
    `SELECT m.status, v.owner_id, m.storage_driver
       FROM media_assets m JOIN vendors v ON v.id = m.vendor_id
      WHERE m.storage_key = $1
      LIMIT 1`,
    [base]
  );
  const row = rows[0];
  if (!row) return { access: "deny", driver: null };
  const driver = row.storage_driver;
  if (row.status === "approved" && file !== "upload.bin") return { access: "public", driver };
  const session = await getLiveSession();
  if (!session) return { access: "deny", driver };
  if (session.role === "admin") return { access: "private", driver };
  if (session.role === "vendor" && row.owner_id === session.userId) return { access: "private", driver };
  return { access: "deny", driver };
}

/** Parses a single "bytes=a-b" range. Returns "invalid" when unsatisfiable, null when absent/ignored. */
function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range or junk: serve the whole file
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return "invalid";
  }
  return { start, end };
}

async function serve(request: Request, { params }: Ctx, headOnly: boolean) {
  const { key: segments } = await params;
  const key = keyFromSegments(segments ?? []);
  if (!key) return plain(400, "Bad request");
  if (isPrivateKey(key)) return plain(404, "Not found");
  const { access, driver } = await accessFor(key);
  if (access === "deny") return plain(404, "Not found");

  const storage = getStorage(driver && driver !== "url" ? driver : currentStorageDriver());

  // Remote drivers (supabase, s3, r2): never proxy the bytes (serverless
  // response limits, cost). Approved media redirects to the bucket's public
  // URL; private media to a short-lived signed URL that is never cached.
  if (storage.driver !== "local") {
    const direct = access === "public" ? storage.directUrl?.(key) : null;
    if (direct) {
      return new Response(null, {
        status: 302,
        headers: { Location: direct, "Cache-Control": "public, max-age=3600" },
      });
    }
    if (!storage.signedUrl) return plain(404, "Not found");
    const signed = await storage.signedUrl(key, 300, key.endsWith("/upload.bin") ? { download: "" } : undefined);
    return new Response(null, {
      status: 302,
      headers: {
        Location: signed,
        "Cache-Control": access === "public" ? "public, max-age=240" : "private, no-store",
      },
    });
  }

  const info = await storage.head(key);
  if (!info) return plain(404, "Not found");

  const base: Record<string, string> = {
    "Content-Type": info.contentType,
    "Cache-Control": access === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    // Raw, not-yet-processed uploads are never rendered inline.
    ...(key.endsWith("/upload.bin") ? { "Content-Disposition": "attachment" } : {}),
  };

  const range = parseRange(request.headers.get("range"), info.bytes);
  if (range === "invalid") {
    return plain(416, "Range not satisfiable", { "Content-Range": `bytes */${info.bytes}` });
  }
  if (range) {
    const length = range.end - range.start + 1;
    const headers = {
      ...base,
      "Content-Range": `bytes ${range.start}-${range.end}/${info.bytes}`,
      "Content-Length": String(length),
    };
    if (headOnly) return new Response(null, { status: 206, headers });
    const obj = await storage.get(key, { range });
    if (!obj) return plain(404, "Not found");
    return new Response(obj.body as BodyInit, { status: 206, headers });
  }

  const headers = { ...base, "Content-Length": String(info.bytes) };
  if (headOnly) return new Response(null, { status: 200, headers });
  const obj = await storage.get(key);
  if (!obj) return plain(404, "Not found");
  return new Response(obj.body as BodyInit, { status: 200, headers });
}

export async function GET(request: Request, ctx: Ctx) {
  return serve(request, ctx, false);
}

export async function HEAD(request: Request, ctx: Ctx) {
  return serve(request, ctx, true);
}
