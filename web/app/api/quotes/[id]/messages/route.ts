import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { addMessage, canAccessThread, findQuoteThread, listMessages } from "@/lib/messages";
import { notify } from "@/lib/notifications";
import { rateLimit } from "@/lib/ratelimit";

async function loadThread(idParam: string) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  const quoteId = parseInt(idParam, 10);
  if (Number.isNaN(quoteId)) {
    return { error: NextResponse.json({ error: "Invalid quote id." }, { status: 400 }) };
  }
  const thread = await findQuoteThread(quoteId);
  // Same 404 whether it doesn't exist or you're not part of it.
  if (!thread || !canAccessThread(thread, session.userId)) {
    return { error: NextResponse.json({ error: "Conversation not found." }, { status: 404 }) };
  }
  return { session, thread };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const loaded = await loadThread(id);
  if ("error" in loaded) return loaded.error;
  const messages = await listMessages(loaded.thread.quote_id);
  return NextResponse.json({ messages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const loaded = await loadThread(id);
  if ("error" in loaded) return loaded.error;
  const { session, thread } = loaded;

  const limited = rateLimit(`msg:${session.userId}`, 60, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json({ error: "You're sending messages too quickly." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const text = typeof (body as Record<string, unknown> | null)?.body === "string"
    ? ((body as Record<string, unknown>).body as string).trim()
    : "";
  if (!text) {
    return NextResponse.json({ error: "Please write a message." }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "Message is too long (2000 characters max)." }, { status: 400 });
  }

  const senderIsVendor = session.userId === thread.vendor_owner_id;
  const recipientId = senderIsVendor ? thread.customer_id : thread.vendor_owner_id;
  if (!recipientId) {
    return NextResponse.json(
      { error: "This customer didn't sign in, so you can only reply to them by phone." },
      { status: 400 }
    );
  }

  const message = await addMessage(thread.quote_id, session.userId, text);
  await notify(recipientId, {
    type: "message",
    title: `New message from ${session.name}`,
    body: text.slice(0, 140),
    link: `/dashboard/quotes/${thread.quote_id}`,
  });

  return NextResponse.json({ message }, { status: 201 });
}
