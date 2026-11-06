-- QA3 fix round, customer/vendor offers (QA-067).
-- Idempotent: safe to run more than once.
--
-- A lead marked Booked (or Declined) by the vendor while an offer was still
-- waiting for the customer's reply left that offer "sent": the vendor saw
-- "Waiting for reply" next to a booked lead and the customer saw "Booked" next
-- to "Offer v1 · waiting for your reply" with no way to answer it. Booking or
-- declining now closes any offer still waiting for a reply (new status
-- 'closed'; an accepted offer stays accepted), and moving the lead back to
-- "replied" reopens the latest closed offer (lib/db.ts, updateVendorLead).
ALTER TABLE quote_offers DROP CONSTRAINT IF EXISTS quote_offers_status_check;
ALTER TABLE quote_offers ADD CONSTRAINT quote_offers_status_check
  CHECK (status IN ('sent', 'accepted', 'declined', 'superseded', 'expired', 'closed'));

-- Existing contradictions: open offers on booked or declined enquiries.
UPDATE quote_offers o SET status = 'closed'
  FROM quote_requests q
 WHERE q.id = o.quote_request_id
   AND o.status = 'sent'
   AND q.status IN ('booked', 'declined');
