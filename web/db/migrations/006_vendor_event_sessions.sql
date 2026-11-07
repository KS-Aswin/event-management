-- P1-12 Analytics: server-side dedupe for profile-view beacons.
-- session_key is a SHA-256 of the anonymous per-browser-session cookie
-- (vela_sid, never the raw value). A profile view is counted at most once per
-- (vendor, session): the partial unique index makes the INSERT ... ON CONFLICT
-- DO NOTHING in POST /api/events idempotent. Clicks are not deduped.
ALTER TABLE vendor_events ADD COLUMN IF NOT EXISTS session_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_events_view_session
  ON vendor_events (vendor_id, session_key)
  WHERE kind = 'profile_view' AND session_key IS NOT NULL;
-- Admin analytics scans events by time.
CREATE INDEX IF NOT EXISTS idx_vendor_events_created ON vendor_events (created_at);
