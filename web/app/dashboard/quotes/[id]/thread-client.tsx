"use client";

import { useEffect, useState } from "react";

interface Message {
  id: number;
  sender_id: number;
  sender_name: string;
  body: string;
  created_at: string;
}

export default function ThreadClient({
  quoteId,
  currentUserId,
  canReply,
  initialMessages,
}: {
  quoteId: number;
  currentUserId: number;
  canReply: boolean;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simple polling keeps the conversation fresh without websockets.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/quotes/${quoteId}/messages`);
        if (!res.ok) return;
        const data = await res.json();
        setMessages(data.messages);
      } catch {
        // ignore a failed poll; the next one will retry
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [quoteId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json();
      setSending(false);
      if (!res.ok) {
        setError(data.error ?? "Could not send your message.");
        return;
      }
      setMessages((prev) => [...prev, data.message]);
      setText("");
    } catch {
      setSending(false);
      setError("Could not reach the server. Please try again.");
    }
  }

  return (
    <div className="border border-line rounded-xl p-5.5">
      <h2 className="text-[15px] font-semibold mb-3">Messages</h2>
      {messages.length === 0 ? (
        <p className="text-sm text-ink-soft mb-3">No messages yet.</p>
      ) : (
        <div className="space-y-2.5 mb-4">
          {messages.map((m) => {
            const mine = m.sender_id === currentUserId;
            return (
              <div key={m.id} className={mine ? "text-right" : "text-left"}>
                <div
                  className={`inline-block max-w-[85%] rounded-xl px-3.5 py-2 text-sm text-left whitespace-pre-wrap ${
                    mine ? "bg-accent text-white" : "bg-gray-100"
                  }`}
                >
                  {m.body}
                </div>
                <div className="text-[11px] text-ink-soft mt-0.5">
                  {mine ? "You" : m.sender_name} · {new Date(m.created_at).toLocaleString("en-IN")}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canReply ? (
        <form onSubmit={send} className="space-y-2.5">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Write a message…"
            className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="px-4.5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-ink-soft">
          This customer didn&apos;t sign in when they asked for a quote, so you can only reach them by phone.
        </p>
      )}
    </div>
  );
}
