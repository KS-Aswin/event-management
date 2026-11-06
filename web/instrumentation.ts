// Runs once when the server starts. Fails fast with one clear message listing
// every missing or invalid environment variable (docs/DEPLOY.md) and a
// misconfigured STORAGE_DRIVER (P0-4 / P3-1), instead of failing on the first
// request or upload.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertServerEnv } = await import("./lib/env");
    assertServerEnv();
    const { assertStorageConfigured } = await import("./lib/storage");
    assertStorageConfigured();
    // Unspoofable client IP for rate limits on self-hosted servers (QA-005).
    const { installPeerIp } = await import("./lib/peer-ip");
    installPeerIp();
  }
}
