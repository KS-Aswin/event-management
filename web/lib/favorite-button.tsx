"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

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
  const pathname = usePathname();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  function goToLogin() {
    router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
  }

  async function toggle(e: React.MouseEvent) {
    e.preventDefault(); // don't follow a parent <Link> (used on vendor cards)
    e.stopPropagation();

    if (!loggedIn) {
      goToLogin();
      return;
    }

    const next = !favorited;
    setFavorited(next); // optimistic
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/vendors/${vendorId}/favorite`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        setFavorited(!next); // roll back
        if (res.status === 401) {
          goToLogin();
        } else {
          setError("Couldn't save, try again");
        }
        return;
      }
      router.refresh();
    } catch {
      setFavorited(!next); // roll back
      setError("Couldn't save, try again");
    } finally {
      setLoading(false);
    }
  }

  const dim = size === "sm" ? 18 : 22;

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
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
          aria-hidden="true"
        >
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
        </svg>
      </button>
      <span
        role="status"
        aria-live="polite"
        className={
          error
            ? "absolute top-full right-0 mt-1 z-10 whitespace-nowrap text-[11px] text-red-700 bg-white border border-red-100 rounded px-1.5 py-0.5 shadow-sm"
            : "sr-only"
        }
      >
        {error ?? ""}
      </span>
    </span>
  );
}
