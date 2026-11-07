import type { StatusEvent, ThreadMessage } from "@/lib/enquiry-thread";
import { formatDate, formatReceived } from "@/app/vendor/leads/format";

// The enquiry conversation (PRODUCT_PLAN P2-5) for either side, plus the
// status timeline. Server components (dates render once on the server).

export function MessageList({
  messages,
  viewer,
  otherName,
  emptyText,
}: {
  messages: ThreadMessage[];
  viewer: "customer" | "vendor";
  otherName: string;
  emptyText: string;
}) {
  if (messages.length === 0) {
    return <p className="text-body text-ink-soft py-3">{emptyText}</p>;
  }
  return (
    <ol className="flex flex-col gap-3" aria-label="Messages">
      {messages.map((m) => {
        const mine = m.senderRole === viewer;
        const who = mine ? "You" : m.senderRole === "system" || m.senderRole === "admin" ? "Vela" : otherName;
        return (
          <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 ${
                mine ? "bg-accent-tint rounded-br-md" : "bg-surface-muted rounded-bl-md"
              }`}
            >
              <p className="text-caption font-medium text-ink-soft">
                {who}
                <span aria-hidden="true"> · </span>
                <time dateTime={m.createdAt}>{formatReceived(m.createdAt)}</time>
                {!mine && !m.readAt && <span className="ml-1.5 chip bg-gold/20 text-gold-ink">New</span>}
              </p>
              <p className="text-body whitespace-pre-line break-words mt-0.5">{m.body}</p>
              {m.masked && <p className="text-caption text-ink-soft mt-1">Contact details are hidden until the lead is unlocked.</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const CUSTOMER_EVENT: Record<string, string> = {
  responded: "Vendor replied",
  accepted: "You accepted the offer",
  booked: "Booked",
  declined: "Vendor declined",
  withdrawn: "You withdrew the enquiry",
  expired: "Expired (event date passed)",
  pending: "Back to waiting for the vendor",
};

const VENDOR_EVENT: Record<string, string> = {
  responded: "Marked replied",
  accepted: "Customer accepted the offer",
  booked: "Booked",
  declined: "Marked not a fit",
  withdrawn: "Customer withdrew",
  expired: "Expired (event date passed)",
  pending: "Back to new",
};

export function StatusTimeline({
  createdAt,
  events,
  viewer,
}: {
  createdAt: string;
  events: StatusEvent[];
  viewer: "customer" | "vendor";
}) {
  const labels = viewer === "customer" ? CUSTOMER_EVENT : VENDOR_EVENT;
  const items = [{ key: "created", label: viewer === "customer" ? "Enquiry sent" : "Enquiry received", at: createdAt, by: "" }].concat(
    events.map((e, i) => {
      let label = labels[e.to] ?? e.to;
      if (e.to === "booked") label = e.actor === "customer" ? (viewer === "customer" ? "You marked it booked" : "Customer marked it booked") : viewer === "customer" ? "Vendor confirmed the booking" : "You marked it booked";
      return { key: `e${i}`, label, at: e.at, by: e.actor };
    })
  );
  return (
    <ol className="relative flex flex-col gap-3 pl-5 before:absolute before:left-[5px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-line" aria-label="Status history">
      {items.map((it, i) => (
        <li key={it.key} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-5 top-1.5 size-[11px] rounded-full border-2 ${i === items.length - 1 ? "bg-accent border-accent" : "bg-white border-line-strong"}`}
          />
          <p className="text-body font-medium leading-snug">{it.label}</p>
          <p className="text-caption text-ink-soft">
            <time dateTime={it.at}>{formatDate(it.at)}</time>
          </p>
        </li>
      ))}
    </ol>
  );
}
