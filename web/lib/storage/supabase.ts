import {
  assertSafeKey,
  contentTypeForKey,
  isPrivateKey,
  type ByteRange,
  type StorageAdapter,
  type StorageObjectBody,
  type StoredObject,
} from "./types";

// Supabase Storage driver (STORAGE_DRIVER=supabase), talking to the Storage
// HTTP API with plain fetch and the project's secret (service) key, so no SDK
// is needed. Keys under private/ (vendor documents) go to a separate private
// bucket; everything else goes to the public media bucket. The browser never
// gets the secret: uploads use signed upload URLs, private reads use signed
// download URLs, and approved media uses the bucket's public URL.

export interface SupabaseStorageConfig {
  /** https://<project>.supabase.co */
  url: string;
  /** sb_secret_... (or the legacy service_role JWT). Server-side only. */
  secretKey: string;
  /** Public bucket for vendor media. */
  bucket: string;
  /** Private bucket for keys under private/. */
  privateBucket: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

// No TypeScript parameter properties here: seed and tests load this file
// with Node's type stripping, which doesn't support them.
export class StorageHttpError extends Error {
  readonly op: string;
  readonly status: number;
  constructor(op: string, status: number, detail: string) {
    super(`Storage ${op} failed (${status}): ${detail.slice(0, 300)}`);
    this.name = "StorageHttpError";
    this.op = op;
    this.status = status;
  }
}

/** Reads the driver's env vars; throws one error naming every missing one. */
export function supabaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseStorageConfig {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!secretKey) missing.push("SUPABASE_SECRET_KEY");
  if (missing.length) {
    throw new Error(`STORAGE_DRIVER=supabase needs ${missing.join(", ")}. See docs/DEPLOY.md.`);
  }
  if (!/^https?:\/\//i.test(url!)) throw new Error("SUPABASE_URL must start with https://");
  const bucket = env.STORAGE_BUCKET?.trim() || "vela-media";
  return {
    url: url!.replace(/\/+$/, ""),
    secretKey: secretKey!,
    bucket,
    privateBucket: env.STORAGE_PRIVATE_BUCKET?.trim() || `${bucket}-private`,
  };
}

/** True when a Supabase error body means "no such object" (it answers 400 with statusCode "404"). */
function isNotFound(status: number, text: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  return /"statusCode"\s*:\s*"404"|NoSuchKey|not_found/i.test(text);
}

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

export class SupabaseStorageAdapter implements StorageAdapter {
  readonly driver = "supabase" as const;
  readonly config: SupabaseStorageConfig;
  private readonly http: typeof fetch;

  constructor(config: SupabaseStorageConfig) {
    this.config = { ...config, url: config.url.replace(/\/+$/, "") };
    this.http = config.fetch ?? ((...a) => fetch(...a));
  }

  private bucketFor(key: string): string {
    return isPrivateKey(key) ? this.config.privateBucket : this.config.bucket;
  }

  private api(path: string): string {
    return `${this.config.url}/storage/v1${path}`;
  }

  private auth(extra?: Record<string, string>): Record<string, string> {
    return { apikey: this.config.secretKey, Authorization: `Bearer ${this.config.secretKey}`, ...extra };
  }

  private objectUrl(key: string): string {
    assertSafeKey(key);
    return this.api(`/object/${this.bucketFor(key)}/${encodeKey(key)}`);
  }

  async put(
    key: string,
    body: Buffer | Uint8Array,
    opts: { contentType: string; cacheControl?: string }
  ): Promise<StoredObject> {
    const res = await this.http(this.objectUrl(key), {
      method: "POST",
      headers: this.auth({
        "Content-Type": opts.contentType,
        "x-upsert": "true",
        // Keys are content-unique, so public objects can be cached for a year.
        "cache-control": opts.cacheControl ?? (isPrivateKey(key) ? "no-store" : "max-age=31536000"),
      }),
      body: body as BodyInit,
    });
    if (!res.ok) throw new StorageHttpError("upload", res.status, await res.text());
    await res.body?.cancel().catch(() => {});
    return { key, contentType: opts.contentType, bytes: body.byteLength };
  }

  async head(key: string): Promise<{ contentType: string; bytes: number } | null> {
    const res = await this.http(this.objectUrl(key), { method: "HEAD", headers: this.auth() });
    if (res.ok) {
      return {
        contentType: res.headers.get("content-type")?.split(";")[0] || contentTypeForKey(key),
        bytes: Number(res.headers.get("content-length") ?? "0"),
      };
    }
    // HEAD has no body, so any 400/404 is "missing".
    if (res.status === 400 || res.status === 404) return null;
    throw new StorageHttpError("head", res.status, res.statusText);
  }

  async get(key: string, opts?: { range?: ByteRange }): Promise<StorageObjectBody | null> {
    const range = opts?.range;
    const res = await this.http(this.objectUrl(key), {
      headers: this.auth(range ? { Range: `bytes=${range.start}-${range.end}` } : undefined),
    });
    if (!res.ok) {
      const text = await res.text();
      if (isNotFound(res.status, text)) return null;
      throw new StorageHttpError("download", res.status, text);
    }
    const contentType = res.headers.get("content-type")?.split(";")[0] || contentTypeForKey(key);
    const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
    const length = Number(res.headers.get("content-length") ?? "0");
    const bytes = total ? Number(total) : length;
    // Small objects are buffered (the media pipeline wants a Buffer); large ones stream.
    if (!range && res.body && length > 2 * 1024 * 1024) {
      return { body: res.body as ReadableStream<Uint8Array>, contentType, bytes };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { body: buf, contentType, bytes: bytes || buf.byteLength };
  }

  private async removeMany(bucket: string, keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const res = await this.http(this.api(`/object/${bucket}`), {
        method: "DELETE",
        headers: this.auth({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefixes: keys.slice(i, i + 1000) }),
      });
      const text = await res.text();
      if (!res.ok && !isNotFound(res.status, text)) throw new StorageHttpError("delete", res.status, text);
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.removeMany(this.bucketFor(key), [key]);
  }

  /** Lists every key under a prefix (recursive; Supabase lists one folder level at a time). */
  async list(prefix: string): Promise<string[]> {
    const root = prefix.replace(/\/+$/, "");
    assertSafeKey(root);
    const bucket = this.bucketFor(root);
    const out: string[] = [];
    const walk = async (folder: string): Promise<void> => {
      for (let offset = 0; ; offset += 1000) {
        const res = await this.http(this.api(`/object/list/${bucket}`), {
          method: "POST",
          headers: this.auth({ "Content-Type": "application/json" }),
          body: JSON.stringify({ prefix: folder, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
        });
        const text = await res.text();
        if (!res.ok) {
          if (isNotFound(res.status, text)) return;
          throw new StorageHttpError("list", res.status, text);
        }
        const entries = JSON.parse(text) as { name: string; id: string | null }[];
        for (const e of entries) {
          const full = `${folder}/${e.name}`;
          // Folders come back with id null.
          if (e.id === null) await walk(full);
          else out.push(full);
        }
        if (entries.length < 1000) return;
      }
    };
    await walk(root);
    return out.sort();
  }

  async deletePrefix(prefix: string): Promise<void> {
    const root = prefix.replace(/\/+$/, "");
    const keys = await this.list(root);
    if (keys.length) await this.removeMany(this.bucketFor(root), keys);
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `/media/${encodeKey(key)}`;
  }

  directUrl(key: string): string | null {
    assertSafeKey(key);
    if (isPrivateKey(key)) return null;
    return this.api(`/object/public/${this.config.bucket}/${encodeKey(key)}`);
  }

  async signedUrl(key: string, expiresInSeconds: number, opts?: { download?: string }): Promise<string> {
    assertSafeKey(key);
    const res = await this.http(this.api(`/object/sign/${this.bucketFor(key)}/${encodeKey(key)}`), {
      method: "POST",
      headers: this.auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: Math.max(1, Math.round(expiresInSeconds)) }),
    });
    const text = await res.text();
    if (!res.ok) throw new StorageHttpError("sign", res.status, text);
    const { signedURL } = JSON.parse(text) as { signedURL: string };
    const url = this.api(signedURL);
    if (opts?.download === undefined) return url;
    return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(opts.download)}`;
  }

  async createUploadUrl(
    key: string,
    contentType: string,
    maxBytes: number
  ): Promise<{ url: string; method: "PUT"; headers?: Record<string, string> }> {
    void maxBytes; // enforced by complete(), which re-reads and checks the object
    assertSafeKey(key);
    const res = await this.http(this.api(`/object/upload/sign/${this.bucketFor(key)}/${encodeKey(key)}`), {
      method: "POST",
      headers: this.auth({ "x-upsert": "true" }),
    });
    const text = await res.text();
    if (!res.ok) throw new StorageHttpError("sign upload", res.status, text);
    const { url } = JSON.parse(text) as { url: string };
    return { url: this.api(url), method: "PUT", headers: { "Content-Type": contentType, "x-upsert": "true" } };
  }

  /** Creates the media (public) and private buckets if they don't exist yet. Idempotent. */
  async ensureBuckets(fileSizeLimit = 52_428_800): Promise<string[]> {
    const res = await this.http(this.api("/bucket"), { headers: this.auth() });
    const text = await res.text();
    if (!res.ok) throw new StorageHttpError("list buckets", res.status, text);
    const existing = new Map((JSON.parse(text) as { id: string; public: boolean }[]).map((b) => [b.id, b.public]));
    const notes: string[] = [];
    for (const [id, isPublic] of [
      [this.config.bucket, true],
      [this.config.privateBucket, false],
    ] as const) {
      if (existing.has(id)) {
        if (existing.get(id) !== isPublic) {
          throw new Error(`Bucket "${id}" must be ${isPublic ? "public" : "private"}; change it in the Supabase dashboard.`);
        }
        notes.push(`${id}: ok`);
        continue;
      }
      const c = await this.http(this.api("/bucket"), {
        method: "POST",
        headers: this.auth({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id, name: id, public: isPublic, file_size_limit: fileSizeLimit }),
      });
      if (!c.ok) throw new StorageHttpError(`create bucket ${id}`, c.status, await c.text());
      notes.push(`${id}: created (${isPublic ? "public" : "private"})`);
    }
    return notes;
  }
}
