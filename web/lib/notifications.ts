import { pool } from "./db";
import { appUrl, sendEmail } from "./email";

export interface NotificationRecord {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

// Creates an in-app notification and, if the user has email notifications on,
// emails a copy. Never throws — a notification problem must not fail the
// action (new quote, status change, message) that triggered it.
export async function notify(
  userId: number,
  n: { type: string; title: string; body?: string; link?: string }
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1,$2,$3,$4,$5)`,
      [userId, n.type, n.title, n.body ?? null, n.link ?? null]
    );
    const userRes = await pool.query<{ email: string; email_notifications: boolean }>(
      "SELECT email, email_notifications FROM users WHERE id = $1",
      [userId]
    );
    const user = userRes.rows[0];
    if (user && user.email_notifications) {
      const lines = [n.body ?? "", n.link ? `Open: ${appUrl()}${n.link}` : ""].filter(Boolean);
      await sendEmail({ to: user.email, subject: n.title, text: lines.join("\n\n") });
    }
  } catch (err) {
    console.error("[notify] failed:", err);
  }
}

export async function listNotifications(userId: number, limit = 30): Promise<NotificationRecord[]> {
  const result = await pool.query<NotificationRecord>(
    "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
    [userId, limit]
  );
  return result.rows;
}

export async function countUnread(userId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false",
    [userId]
  );
  return parseInt(result.rows[0].count, 10);
}

export async function markAllRead(userId: number): Promise<void> {
  await pool.query("UPDATE notifications SET read = true WHERE user_id = $1 AND read = false", [userId]);
}
