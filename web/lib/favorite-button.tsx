"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FavoriteButton({
  vendorId,
  initialFavorited,
  loggedIn,
  size = "md",
}: {
  vendorId: number;
  initialFavorited: boolean;
  loggedIn: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [loading, setLoading] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault(); // don't follow a parent <Link> (used on vendor cards)
    e.stopPropagation();

    if (!loggedIn) {
      router.push("/login");
      return;
    }

    const next = !favorited;
    setFavorited(next); // optimistic
    setLoading(true);
    const res = await fetch(`/api/vendors/${vendorId}/favorite`, {
      method: next ? "POST" : "DELETE",
    });
    setLoading(false);
    if (!res.ok) {
      setFavorited(!next); // roll back
      return;
    }
    router.refresh();
  }

  const dim = size === "sm" ? 18 : 22;

  return (
    <button
      onClick={toggle}
      disabled={loading}
      aria-label={favorited ? "Remove from favorites" : "Save to favorites"}
      className="shrink-0 disabled:opacity-60"
    >
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 24 24"
        fill={favorited ? "#c9a227" : "none"}
        stroke={favorited ? "#c9a227" : "currentColor"}
        strokeWidth="1.8"
        className={favorited ? "" : "text-ink-soft"}
      >
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
    </button>
  );
}
