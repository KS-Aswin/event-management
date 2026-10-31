import { vendorStatusLabel } from "./routes";

// Listing status pill (vendors.status). Colour carries meaning, the dot and
// the text carry it too, so it never relies on colour alone.
const TONE: Record<string, string> = {
  approved: "bg-accent-tint text-accent-hover",
  pending: "bg-[#fbf3d9] text-gold-ink",
  changes_requested: "bg-[#fbf3d9] text-gold-ink",
  rejected: "bg-danger-tint text-danger",
  suspended: "bg-danger-tint text-danger",
};

export default function StatusChip({
  status,
  className = "",
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const tone = (status && TONE[status]) || "bg-surface-muted text-[#3c4043]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap ${tone} ${className}`}
      data-status={status ?? "none"}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      <span className="sr-only">Listing status: </span>
      {vendorStatusLabel(status)}
    </span>
  );
}
