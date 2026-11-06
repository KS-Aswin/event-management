import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile, rename, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  assertSafeKey,
  contentTypeForKey,
  type ByteRange,
  type StorageAdapter,
  type StorageObjectBody,
  type StoredObject,
} from "./types";

/** Default uploads root: web/uploads (git-ignored, outside public/). */
export function defaultUploadsRoot(): string {
  // turbopackIgnore: the uploads folder is runtime data, not code; without it
  // Turbopack traces the whole project into the server bundle.
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.UPLOADS_DIR || process.env.STORAGE_LOCAL_ROOT || path.join(process.cwd(), "uploads")
  );
}

/**
 * Local-disk driver for development (docs/PRODUCT_PLAN.md 4.4). Files live
 * under the uploads root and are served by app/media/[...key]/route.ts.
 * Not for Vercel (read-only filesystem): use the supabase or s3 driver there.
 */
export class LocalDiskAdapter implements StorageAdapter {
  readonly driver = "local" as const;
  readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(/*turbopackIgnore: true*/ root ?? defaultUploadsRoot());
  }

  /** Absolute path for a key; throws for keys that could escape the root. */
  resolvePath(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(/*turbopackIgnore: true*/ this.root, ...key.split("/"));
    const rel = path.relative(this.root, full);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Storage key resolves outside the uploads root.");
    }
    return full;
  }

  async put(
    key: string,
    body: Buffer | Uint8Array,
    opts: { contentType: string; cacheControl?: string }
  ): Promise<StoredObject> {
    // Vercel (and most serverless hosts) have a read-only, ephemeral disk.
    if (process.env.NODE_ENV === "production" && (process.env.VERCEL || process.env.STORAGE_ALLOW_LOCAL !== "1")) {
      throw new Error("The local storage driver does not write in production. Set STORAGE_DRIVER=supabase, s3 or r2.");
    }
    const file = this.resolvePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    // Write to a temp file then rename, so a reader never sees a half file.
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, file);
    return { key, contentType: opts.contentType, bytes: body.byteLength };
  }

  async head(key: string): Promise<{ contentType: string; bytes: number } | null> {
    const file = this.resolvePath(key);
    try {
      const s = await stat(file);
      if (!s.isFile()) return null;
      return { contentType: contentTypeForKey(key), bytes: s.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async get(key: string, opts?: { range?: ByteRange }): Promise<StorageObjectBody | null> {
    const info = await this.head(key);
    if (!info) return null;
    const file = this.resolvePath(key);
    const range = opts?.range;
    if (!range) {
      // Small files are returned as a Buffer; large ones (video) as a stream.
      if (info.bytes <= 2 * 1024 * 1024) {
        return { body: await readFile(file), contentType: info.contentType, bytes: info.bytes };
      }
      const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
      return { body: stream, contentType: info.contentType, bytes: info.bytes };
    }
    const stream = Readable.toWeb(
      createReadStream(file, { start: range.start, end: range.end })
    ) as ReadableStream<Uint8Array>;
    return { body: stream, contentType: info.contentType, bytes: info.bytes };
  }

  async delete(key: string): Promise<void> {
    const file = this.resolvePath(key);
    await rm(file, { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    const dir = this.resolvePath(prefix.replace(/\/+$/, ""));
    await rm(dir, { recursive: true, force: true });
  }

  /** Lists keys under a prefix (used by tests and the cleanup janitor). */
  async list(prefix: string): Promise<string[]> {
    const dir = this.resolvePath(prefix.replace(/\/+$/, ""));
    const out: string[] = [];
    const walk = async (d: string, rel: string) => {
      let entries;
      try {
        entries = await readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(d, e.name), r);
        else out.push(`${prefix.replace(/\/+$/, "")}/${r}`);
      }
    };
    await walk(dir, "");
    return out.sort();
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
}
