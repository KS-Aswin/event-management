import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { listNotifications, markAllRead } from "@/lib/notifications";

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const items = await listNotifications(session.userId, 50);
  // Opening the page counts as reading them (the list above keeps the unread
  // styling for this visit).
  await markAllRead(session.userId);

  return (
    <main className="max-w-2xl mx-auto px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold mb-1">Notifications</h1>
      <p className="text-ink-soft text-sm mb-6">New quotes, replies, messages and reviews.</p>

      {items.length === 0 ? (
        <div className="border border-line rounded-xl p-5.5 text-sm text-ink-soft">
          Nothing yet. You&apos;ll see updates here when someone replies or sends a request.
        </div>
      ) : (
        <div className="border border-line rounded-xl overflow-hidden">
          {items.map((n, i) => {
            const content = (
              <div
                className={`px-5 py-3.5 text-sm ${i < items.length - 1 ? "border-b border-line" : ""} ${
                  n.read ? "" : "bg-accent-tint"
                }`}
              >
                <div className="font-medium">{n.title}</div>
                {n.body && <div className="text-ink-soft text-[13px] mt-0.5">{n.body}</div>}
                <div className="text-ink-soft text-[11px] mt-1">
                  {new Date(n.created_at).toLocaleString("en-IN")}
                </div>
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link} className="block hover:bg-gray-50">
                {content}
              </Link>
            ) : (
              <div key={n.id}>{content}</div>
            );
          })}
        </div>
      )}
    </main>
  );
}
