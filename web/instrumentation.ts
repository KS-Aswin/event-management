// Runs once when the server starts. Fails fast on a misconfigured
// STORAGE_DRIVER (docs/PRODUCT_PLAN.md P0-4) instead of failing on the first upload.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertStorageConfigured } = await import("./lib/storage");
    assertStorageConfigured();
  }
}
