import Link from "next/link";
import type { BrowseVendor } from "@/lib/search";
import type { CardMedia } from "@/app/search/card-media";
import CardImage from "@/app/search/card-image";

/** Compact vendor row for the /e and /c browse pages. */
export default function VendorMiniCard({ v, media }: { v: BrowseVendor; media?: CardMedia }) {
  const unit = v.from_unit_label || v.from_unit;
  return (
    <Link
      href={`/vendors/${v.id}`}
      className="group flex items-center gap-3 rounded-control p-2 -mx-2 min-h-11 hover:bg-surface-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <CardImage
        src={media?.src ?? null}
        color={media?.color ?? null}
        category={v.category}
        className="w-14 h-14 sm:w-16 sm:h-16 rounded-control!"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold truncate group-hover:text-accent">{v.name}</span>
          {v.verified && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-accent shrink-0" role="img" aria-label="Verified business">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        <span className="block text-[13px] text-ink-soft truncate mt-0.5">
          {v.location}
          {v.reviews_count > 0 ? (
            <>
              {" · "}
              <span className="text-gold" aria-hidden="true">★</span> {v.rating} ({v.reviews_count})
            </>
          ) : (
            " · New"
          )}
        </span>
        {v.from_price != null && (
          <span className="block text-[13px] font-semibold text-accent mt-0.5 tabular-nums">
            From ₹{v.from_price.toLocaleString("en-IN")}
            {unit ? ` / ${unit}` : ""}
          </span>
        )}
      </span>
    </Link>
  );
}
