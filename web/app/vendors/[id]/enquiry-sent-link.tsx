import Link from "next/link";
import { formatDate } from "@/app/vendor/leads/format";

// QA-040: tells a signed-in customer they already have an open enquiry with
// this vendor (like the shortlist's "Enquiry sent · view"), so they follow up
// there instead of sending the same request again.

const STATUS_TEXT: Record<string, string> = {
  pending: "Enquiry sent",
  responded: "Vendor replied",
  accepted: "Offer accepted",
  booked: "Booked",
};

export default function EnquirySentLink({
  enquiry,
  className = "",
}: {
  enquiry: { id: number; eventDate: string | null; status: string };
  className?: string;
}) {
  const what = STATUS_TEXT[enquiry.status] ?? "Enquiry sent";
  const when = enquiry.eventDate ? ` for ${formatDate(enquiry.eventDate)}` : "";
  return (
    <p className={`text-sm ${className}`}>
      <Link
        href={`/my/enquiries/${enquiry.id}`}
        className="inline-flex items-center gap-1.5 min-h-11 font-medium text-accent hover:underline underline-offset-2"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4 shrink-0" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
        {what}
        {when} · view
      </Link>
    </p>
  );
}
