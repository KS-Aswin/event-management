import { pool } from "./db";

// A message thread belongs to one quote request and is shared by the customer
// who sent it and the vendor who owns the listing.
export interface QuoteThreadInfo {
  quote_id: number;
  vendor_id: number;
  vendor_name: string;
  vendor_owner_id: number | null;
  customer_id: number | null;
  customer_name: string;
  phone: string;
  status: string;
  event_date: string | null; // YYYY-MM-DD
  budget: string | null;
  message: string | null;
  created_at: string;
}

export async function findQuoteThread(quoteId: number): Promise<QuoteThreadInfo | null> {
  const result = await pool.query<QuoteThreadInfo>(
    `SELECT q.id AS quote_id, q.vendor_id, v.name AS vendor_name, v.owner_id AS vendor_owner_id,
            q.customer_id, q.name AS customer_name, q.phone, q.status,
            to_char(q.event_date, 'YYYY-MM-DD') AS event_date,
            q.budget, q.message, q.created_at
     FROM quote_requests q
     JOIN vendors v ON v.id = q.vendor_id
     WHERE q.id = $1`,
    [quoteId]
  );
  return result.rows[0] ?? null;
}

export function canAccessThread(info: QuoteThreadInfo, userId: number): boolean {
  return userId === info.vendor_owner_id || userId === info.customer_id;
}

export interface MessageRecord {
  id: number;
  quote_id: number;
  sender_id: number;
  sender_name: string;
  body: string;
  created_at: string;
}

export async function listMessages(quoteId: number): Promise<MessageRecord[]> {
  const result = await pool.query<MessageRecord>(
    `SELECT m.id, m.quote_id, m.sender_id, u.name AS sender_name, m.body, m.created_at
     FROM quote_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.quote_id = $1
     ORDER BY m.created_at ASC, m.id ASC`,
    [quoteId]
  );
  return result.rows;
}

export async function addMessage(quoteId: number, senderId: number, body: string): Promise<MessageRecord> {
  const result = await pool.query<MessageRecord>(
    `WITH ins AS (
       INSERT INTO quote_messages (quote_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *
     )
     SELECT ins.id, ins.quote_id, ins.sender_id, u.name AS sender_name, ins.body, ins.created_at
     FROM ins JOIN users u ON u.id = ins.sender_id`,
    [quoteId, senderId, body]
  );
  return result.rows[0];
}
