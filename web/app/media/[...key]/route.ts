import { getStorage, isPrivateKey, isSafeKey } from "@/lib/storage";

// Serves stored media for the local driver (docs/PRODUCT_PLAN.md 4.4):
// correct Content-Type, immutable caching (keys are content-unique),
// HTTP Range for MP4 seeking, traversal -> 400, private/ -> 404.

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

  const storage = getStorage("local");
  const info = await storage.head(key);
  if (!info) return plain(404, "Not found");

  const base: Record<string, string> = {
    "Content-Type": info.contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
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
