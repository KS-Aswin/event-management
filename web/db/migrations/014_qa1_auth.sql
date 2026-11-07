-- qa1 fix round, auth group (QA-005, QA-007). Idempotent.
--
-- A. rate_limit_counters: shared fixed-window counters for the abuse limits
--    on sign-in, sign-up and password reset (lib/rate-limit.ts rateLimitHit /
--    rateLimitPeek). On serverless hosting every instance has its own memory,
--    so in-memory counts don't add up; this table is shared by all of them.
--    `key` is a sha256 of the logical key (no raw emails or IPs stored).
--    Expired rows are deleted opportunistically by the app.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_reset ON rate_limit_counters (reset_at);

-- B. password_reset_tokens: one-time, expiring password reset links (QA-007).
--    There is no email provider yet, so an admin creates the link from
--    /admin/users/<id> after checking who is asking, and passes it on. Only
--    a sha256 of the token is stored; the link is shown once.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id, created_at DESC);
