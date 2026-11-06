-- 009: enquiry thread, offers and in-app notifications (PRODUCT_PLAN P2-4,
-- P2-5, P2-13). The tables already exist (004); this adds what the thread
-- needs on top. Idempotent: safe to run again.

-- Unread messages per enquiry (bell counts, inbox dots).
CREATE INDEX IF NOT EXISTS idx_quote_messages_unread
  ON quote_messages (quote_request_id, sender_role) WHERE read_at IS NULL;

-- Offers: newest version per enquiry, and the "still open" sweep.
CREATE INDEX IF NOT EXISTS idx_quote_offers_request ON quote_offers (quote_request_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_quote_offer_lines_offer ON quote_offer_lines (offer_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_quote_status_events_quote_time ON quote_status_events (quote_id, created_at);

-- At most one live (sent or accepted) offer per enquiry: sending vN
-- supersedes the previous one in the same transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_offers_live
  ON quote_offers (quote_request_id) WHERE status IN ('sent', 'accepted');

-- Notifications that belong to one enquiry (opening the thread marks them read).
CREATE INDEX IF NOT EXISTS idx_notifications_quote
  ON notifications (user_id, ((payload->>'quoteId'))) WHERE read_at IS NULL;

-- New lead -> the vendor's bell, in the same transaction as the INSERT, for
-- every way an enquiry is created (single, multi-vendor, admin, guest).
-- Seeded listings with no owner are skipped.
CREATE OR REPLACE FUNCTION vela_notify_new_lead() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_owner INT;
BEGIN
  SELECT owner_id INTO v_owner FROM vendors WHERE id = NEW.vendor_id;
  IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM NEW.customer_id THEN
    INSERT INTO notifications (user_id, kind, payload)
    VALUES (
      v_owner,
      'lead.new',
      jsonb_build_object(
        'title', 'New enquiry from ' || left(NEW.name, 60),
        'body', CASE WHEN NEW.event_date IS NOT NULL
                     THEN 'Event on ' || to_char(NEW.event_date, 'FMDD Mon YYYY')
                     ELSE 'No event date given yet' END,
        'link', '/vendor/leads/' || NEW.id,
        'quoteId', NEW.id
      )
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_new_lead ON quote_requests;
CREATE TRIGGER trg_notify_new_lead
  AFTER INSERT ON quote_requests
  FOR EACH ROW EXECUTE FUNCTION vela_notify_new_lead();
