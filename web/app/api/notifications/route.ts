import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { countUnread, listNotifications, markAllRead } from "@/lib/notifications";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const [notifications, unread] = await Promise.all([
    listNotifications(session.userId),
    countUnread(session.userId),
  ]);
  return NextResponse.json({ notifications, unread });
}

// Marks every notification as read.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  await markAllRead(session.userId);
  return NextResponse.json({ ok: true });
}
