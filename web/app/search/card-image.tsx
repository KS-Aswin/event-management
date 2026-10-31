"use client";

// Search card thumbnail: next/image with the category gradient as the final
// fallback, so a missing or failing image never shows a broken icon.

import { useState } from "react";
import Image from "next/image";
import { VendorTile } from "@/lib/vendorVisuals";

export default function CardImage({
  src,
  color,
  category,
  hasVideo = false,
  className = "",
}: {
  src: string | null;
  color: string | null;
  category: string;
  hasVideo?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = src && !failed;
  return (
    <div
      className={`relative overflow-hidden rounded-card shrink-0 ${className}`}
      style={show && color ? { backgroundColor: color } : undefined}
    >
      {show ? (
        <Image
          src={src}
          alt=""
          fill
          unoptimized
          sizes="(min-width: 640px) 200px, 88px"
          className="object-cover bg-surface-muted"
          onError={() => setFailed(true)}
        />
      ) : (
        <VendorTile category={category} size={32} className="absolute inset-0 h-full w-full" />
      )}
      {hasVideo ? (
        <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[10.5px] font-medium text-white sm:px-2 sm:text-[11px]">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
          </svg>
          Video
        </span>
      ) : null}
    </div>
  );
}
