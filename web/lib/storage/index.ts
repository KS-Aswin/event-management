import { LocalDiskAdapter } from "./local";
import { parseStorageDriver, type StorageAdapter, type StorageDriver } from "./types";

export * from "./types";
export { LocalDiskAdapter, defaultUploadsRoot } from "./local";

const cache = new Map<StorageDriver, StorageAdapter>();

/**
 * Returns the storage adapter for `driver` (default: STORAGE_DRIVER, then
 * "local"). Unknown names throw with a clear message; drivers that are
 * planned but not built yet (s3, r2, supabase: P3) throw too, so a
 * misconfigured deploy fails fast instead of losing uploads.
 */
export function getStorage(driver: string | null | undefined = process.env.STORAGE_DRIVER): StorageAdapter {
  const name = parseStorageDriver(driver);
  const hit = cache.get(name);
  if (hit) return hit;
  let adapter: StorageAdapter;
  switch (name) {
    case "local":
      adapter = new LocalDiskAdapter();
      break;
    default:
      throw new Error(
        `STORAGE_DRIVER "${name}" is not implemented yet (planned for P3). Use "local" for now.`
      );
  }
  cache.set(name, adapter);
  return adapter;
}

/** The driver new uploads are written with. */
export function currentStorageDriver(): StorageDriver {
  return parseStorageDriver(process.env.STORAGE_DRIVER);
}

/** Startup check used by instrumentation.ts. */
export function assertStorageConfigured(): void {
  getStorage();
}
