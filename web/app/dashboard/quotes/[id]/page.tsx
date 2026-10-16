import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { canAccessThread, findQuoteThread, listMessages } from "@/lib/messages";
import LeadStatusControl from "../../lead-status-control";
import ThreadClient from "./thread-client";

export default async function QuoteThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (Number.isNaN(quoteId)) notFound();

  const thread = await findQuoteThread(quoteId);
  if (!thread || !canAccessThread(thread, session.userId)) notFound();

  const messages = await listMessages(quoteId);
  const isVendor = session.userId === thread.vendor_owner_id;
  const canReply = isVendor ? thread.customer_id !== null : true;

  return (
    <main className="max-w-2xl mx-auto px-6 py-10 w-full">
      <Link href="/dashboard" className="text-sm text-accent hover:underline">
        ← Dashboard
      </Link>

      <div className="border border-line rounded-xl p-5.5 mt-3 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">
              {isVendor ? thread.customer_name : thread.vendor_name}
            </h1>
            <p className="text-[13px] text-ink-soft mt-0.5">
              Quote request · {new Date(thread.created_at).toLocaleDateString("en-IN")}
            </p>
          </div>
          {isVendor ? (
            <LeadStatusControl quoteId={thread.quote_id} status={thread.status} />
          ) : (
            <span className="text-xs bg-accent-tint text-accent rounded-full px-2.5 py-1">{thread.status}</span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-4">
          <div>
            <dt className="text-ink-soft text-xs">Event date</dt>
            <dd>{thread.event_date ? new Date(thread.event_date).toLocaleDateString("en-IN") : "Not given"}</dd>
          </div>
          <div>
            <dt className="text-ink-soft text-xs">Budget</dt>
            <dd>{thread.budget ? `₹${thread.budget}` : "Not given"}</dd>
          </div>
          {isVendor && (
            <div>
              <dt className="text-ink-soft text-xs">Phone</dt>
              <dd>{thread.phone}</dd>
            </div>
          )}
          {thread.message && (
            <div className="col-span-2">
              <dt className="text-ink-soft text-xs">Original message</dt>
              <dd className="whitespace-pre-wrap">{thread.message}</dd>
            </div>
          )}
        </dl>
      </div>

      <ThreadClient
        quoteId={thread.quote_id}
        currentUserId={session.userId}
        canReply={canReply}
        initialMessages={messages.map((m) => ({
          id: m.id,
          sender_id: m.sender_id,
          sender_name: m.sender_name,
          body: m.body,
          created_at: new Date(m.created_at).toISOString(),
        }))}
      />
    </main>
  );
}
