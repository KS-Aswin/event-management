import { createHash, createHmac } from "node:crypto";
import {
  assertSafeKey,
  contentTypeForKey,
  isPrivateKey,
  type ByteRange,
  type StorageAdapter,
  type StorageObjectBody,
  type StoredObject,
} from "./types";

// S3-compatible driver (STORAGE_DRIVER=s3 or r2): Cloudflare R2, MinIO,
// Supabase Storage's S3 endpoint, AWS S3. Requests are signed with AWS
// Signature V4 using node:crypto, so no AWS SDK is needed. Path-style URLs
// (<endpoint>/<bucket>/<key>) work with all of them.

export interface S3StorageConfig {
  driver: "s3" | "r2";
  /** e.g. https://<account>.r2.cloudflarestorage.com, https://<ref>.supabase.co/storage/v1/s3, http://localhost:9000 */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  privateBucket: string;
  /** Public base URL of the media bucket (no trailing slash), e.g. an R2 public URL; null = no direct URLs. */
  publicBaseUrl: string | null;
  fetch?: typeof fetch;
  /** Injected in tests. */
  now?: () => Date;
}

export function s3ConfigFromEnv(driver: "s3" | "r2", env: NodeJS.ProcessEnv = process.env): S3StorageConfig {
  const need = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  const missing = need.filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`STORAGE_DRIVER=${driver} needs ${missing.join(", ")}. See docs/DEPLOY.md.`);
  const bucket = env.STORAGE_BUCKET?.trim() || "vela-media";
  return {
    driver,
    endpoint: env.S3_ENDPOINT!.trim().replace(/\/+$/, ""),
    region: env.S3_REGION?.trim() || (driver === "r2" ? "auto" : "us-east-1"),
    accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
    bucket,
    privateBucket: env.STORAGE_PRIVATE_BUCKET?.trim() || `${bucket}-private`,
    publicBaseUrl: env.S3_PUBLIC_URL?.trim().replace(/\/+$/, "") || null,
  };
}

// ---- Signature V4 ----------------------------------------------------------

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it ("/" kept in paths). */
export function uriEncode(s: string, keepSlash = false): string {
  const out = encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? out.replace(/%2F/g, "/") : out;
}

function amzDates(now: Date) {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join("&");
}

interface SignInput {
  method: string;
  /** Already-encoded absolute path, e.g. /bucket/key */
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}

function signature(input: SignInput, amzDate: string, day: string, signedHeaders: string[], query: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${lower[h]}\n`).join("");
  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders.join(";"),
    input.payloadHash,
  ].join("\n");
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, input.region), "s3"), "aws4_request");
  return { sig: createHmac("sha256", kSigning).update(toSign).digest("hex"), scope };
}

/** Signs a request with an Authorization header. `headers` must include host. Returns the headers to send. */
export function signHeaders(input: SignInput): Record<string, string> {
  const { amzDate, day } = amzDates(input.now);
  const headers = { ...input.headers, "x-amz-date": amzDate, "x-amz-content-sha256": input.payloadHash };
  const signed = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const { sig, scope } = signature({ ...input, headers }, amzDate, day, signed, input.query);
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${sig}`,
  };
}

/** Builds a presigned query string (only host is signed). */
export function presignQuery(input: Omit<SignInput, "payloadHash" | "headers"> & { host: string; expires: number }): string {
  const { amzDate, day } = amzDates(input.now);
  const query: Record<string, string> = {
    ...input.query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${day}/${input.region}/s3/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expires),
    "X-Amz-SignedHeaders": "host",
  };
  const { sig } = signature(
    { ...input, headers: { host: input.host }, payloadHash: "UNSIGNED-PAYLOAD" },
    amzDate,
    day,
    ["host"],
    query
  );
  return `${canonicalQuery(query)}&X-Amz-Signature=${sig}`;
}

// ---- Adapter ---------------------------------------------------------------

export class S3StorageAdapter implements StorageAdapter {
  readonly driver: "s3" | "r2";
  readonly config: S3StorageConfig;
  private readonly http: typeof fetch;
  private readonly base: URL;

  constructor(config: S3StorageConfig) {
    this.config = config;
    this.driver = config.driver;
    this.http = config.fetch ?? ((...a) => fetch(...a));
    this.base = new URL(config.endpoint);
  }

  private bucketFor(key: string) {
    return isPrivateKey(key) ? this.config.privateBucket : this.config.bucket;
  }

  private pathFor(bucket: string, key?: string) {
    const basePath = this.base.pathname.replace(/\/+$/, "");
    return `${basePath}/${uriEncode(bucket)}${key === undefined ? "" : `/${uriEncode(key, true)}`}`;
  }

  private async send(
    method: string,
    path: string,
    opts: { query?: Record<string, string>; headers?: Record<string, string>; body?: Uint8Array } = {}
  ): Promise<Response> {
    const query = opts.query ?? {};
    const headers = signHeaders({
      method,
      path,
      query,
      headers: { host: this.base.host, ...(opts.headers ?? {}) },
      payloadHash: opts.body ? sha256(opts.body) : EMPTY_SHA256,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      now: this.config.now?.() ?? new Date(),
    });
    delete headers.host; // fetch sets Host itself
    const qs = canonicalQuery(query);
    return this.http(`${this.base.origin}${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers,
      body: opts.body as BodyInit | undefined,
    });
  }

  private async fail(op: string, res: Response): Promise<never> {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 ${op} failed (${res.status}): ${text.slice(0, 300)}`);
  }

  async put(key: string, body: Buffer | Uint8Array, opts: { contentType: string; cacheControl?: string }): Promise<StoredObject> {
    assertSafeKey(key);
    const res = await this.send("PUT", this.pathFor(this.bucketFor(key), key), {
      headers: {
        "content-type": opts.contentType,
        "cache-control": opts.cacheControl ?? (isPrivateKey(key) ? "no-store" : "public, max-age=31536000, immutable"),
      },
      body,
    });
    if (!res.ok) await this.fail("put", res);
    await res.body?.cancel().catch(() => {});
    return { key, contentType: opts.contentType, bytes: body.byteLength };
  }

  async head(key: string): Promise<{ contentType: string; bytes: number } | null> {
    assertSafeKey(key);
    const res = await this.send("HEAD", this.pathFor(this.bucketFor(key), key));
    if (res.status === 404) return null;
    if (!res.ok) await this.fail("head", res);
    return {
      contentType: res.headers.get("content-type")?.split(";")[0] || contentTypeForKey(key),
      bytes: Number(res.headers.get("content-length") ?? "0"),
    };
  }

  async get(key: string, opts?: { range?: ByteRange }): Promise<StorageObjectBody | null> {
    assertSafeKey(key);
    const range = opts?.range;
    const res = await this.send("GET", this.pathFor(this.bucketFor(key), key), {
      headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
    });
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    if (!res.ok) await this.fail("get", res);
    const contentType = res.headers.get("content-type")?.split(";")[0] || contentTypeForKey(key);
    const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
    const length = Number(res.headers.get("content-length") ?? "0");
    const bytes = total ? Number(total) : length;
    if (!range && res.body && length > 2 * 1024 * 1024) {
      return { body: res.body as ReadableStream<Uint8Array>, contentType, bytes };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { body: buf, contentType, bytes: bytes || buf.byteLength };
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const res = await this.send("DELETE", this.pathFor(this.bucketFor(key), key));
    if (!res.ok && res.status !== 404) await this.fail("delete", res);
    await res.body?.cancel().catch(() => {});
  }

  async list(prefix: string): Promise<string[]> {
    const root = prefix.replace(/\/+$/, "");
    assertSafeKey(root);
    const out: string[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", prefix: `${root}/` };
      if (token) query["continuation-token"] = token;
      const res = await this.send("GET", this.pathFor(this.bucketFor(root)), { query });
      if (!res.ok) await this.fail("list", res);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) out.push(decodeXml(m[1]));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? decodeXml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") || undefined
        : undefined;
    } while (token);
    return out.sort();
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of await this.list(prefix)) await this.delete(key);
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  directUrl(key: string): string | null {
    assertSafeKey(key);
    if (isPrivateKey(key) || !this.config.publicBaseUrl) return null;
    return `${this.config.publicBaseUrl}/${uriEncode(key, true)}`;
  }

  private presigned(method: "GET" | "PUT", key: string, expires: number, extraQuery: Record<string, string> = {}) {
    assertSafeKey(key);
    const path = this.pathFor(this.bucketFor(key), key);
    const qs = presignQuery({
      method,
      path,
      query: extraQuery,
      host: this.base.host,
      expires: Math.min(604_800, Math.max(1, Math.round(expires))),
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      now: this.config.now?.() ?? new Date(),
    });
    return `${this.base.origin}${path}?${qs}`;
  }

  async signedUrl(key: string, expiresInSeconds: number, opts?: { download?: string }): Promise<string> {
    const extra: Record<string, string> = opts?.download !== undefined
      ? { "response-content-disposition": `attachment${opts.download ? `; filename="${opts.download.replace(/["\\]/g, "")}"` : ""}` }
      : {};
    return this.presigned("GET", key, expiresInSeconds, extra);
  }

  async createUploadUrl(key: string, contentType: string, maxBytes: number) {
    void maxBytes; // enforced by complete()
    return { url: this.presigned("PUT", key, 900), method: "PUT" as const, headers: { "Content-Type": contentType } };
  }
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
