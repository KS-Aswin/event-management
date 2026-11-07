-- QA-081: signing out revokes that session on the server.
-- Idempotent: safe to run more than once.
--
-- Sessions are signed tokens (jose) that stay valid until they expire (7
-- days). "Log out" now records the token's SHA-256 here, and every live
-- session check (resolveLiveSession, the /admin proxy re-check) refuses a
-- revoked token, so a copied cookie stops working once its owner signs out.
-- "Sign out of other devices" and a password change bump users.session_version
-- instead (migration 004), which ends every other session at once.
-- Rows are only needed until the token would have expired anyway; logout
-- sweeps expired rows.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  token_hash text PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revoked_sessions_expires_idx ON revoked_sessions (expires_at);
