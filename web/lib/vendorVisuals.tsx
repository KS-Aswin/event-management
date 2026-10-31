// Category artwork (gradient + line icon) keyed by category SLUG. The list of
// categories itself comes from the database (/api/meta/taxonomy or
// getTaxonomy() in lib/taxonomy.ts), so a category added in the DB shows up
// everywhere; one without artwork here gets the neutral fallback.

/**
 * @deprecated Hard-coded category list kept only so pages not yet moved to the
 * taxonomy API still compile. Use getTaxonomy() / GET /api/meta/taxonomy.
 */
export const CATEGORIES = [
  "Venue",
  "Photography",
  "Catering",
  "Decoration",
  "DJ & Music",
  "Makeup",
  "Mehendi",
] as const;

/** @deprecated See CATEGORIES. */
export type Category = (typeof CATEGORIES)[number];

interface CategoryVisual {
  gradient: string;
  icon: React.ReactNode;
}

const iconProps = {
  fill: "none",
  stroke: "#ffffff",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Visuals by categories.slug. */
export const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  "event-management": {
    gradient: "linear-gradient(135deg,#0f766e,#134e4a)",
    icon: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
      </>
    ),
  },
  venue: {
    gradient: "linear-gradient(135deg,#12855f,#0b5940)",
    icon: (
      <path d="M4 21h16M6 21V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v15M9.5 9h1M13.5 9h1M9.5 13h1M13.5 13h1M9.5 17h1M13.5 17h1" />
    ),
  },
  photography: {
    gradient: "linear-gradient(135deg,#4b5563,#1f2937)",
    icon: (
      <>
        <path d="M22 18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5L9 4h6l1.5 2H20a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
  },
  videography: {
    gradient: "linear-gradient(135deg,#334155,#0f172a)",
    icon: (
      <>
        <rect x="2" y="6" width="14" height="12" rx="2" />
        <path d="m16 10 6-3v10l-6-3z" />
      </>
    ),
  },
  catering: {
    gradient: "linear-gradient(135deg,#c2760f,#8a4e0a)",
    icon: <path d="M4 3v6a2 2 0 0 0 2 2v10M4 3v6M8 3v6M6 11V3M17 3c-1.5 0-3 1.5-3 4v4a2 2 0 0 0 2 2v8M17 3v18" />,
  },
  decoration: {
    gradient: "linear-gradient(135deg,#c2477a,#8f2f56)",
    icon: (
      <>
        <path d="M12 12a4 4 0 1 1 4-4h-4zM12 12a4 4 0 1 0-4-4h4zM12 12v2m-4-2a4 4 0 1 0 4 4v-4zm8 0a4 4 0 1 1-4 4v-4z" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
  },
  "dj-music": {
    gradient: "linear-gradient(135deg,#5b3fae,#37276f)",
    icon: (
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
  },
  "traditional-music": {
    gradient: "linear-gradient(135deg,#b45309,#78350f)",
    icon: (
      <>
        <ellipse cx="12" cy="7" rx="7" ry="3" />
        <path d="M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7M4 2l5 5M20 2l-5 5" />
      </>
    ),
  },
  "sound-lighting": {
    gradient: "linear-gradient(135deg,#1d4ed8,#1e3a8a)",
    icon: (
      <>
        <rect x="6" y="2" width="12" height="20" rx="2" />
        <circle cx="12" cy="14" r="4" />
        <circle cx="12" cy="6.5" r="1" />
      </>
    ),
  },
  makeup: {
    gradient: "linear-gradient(135deg,#c2478f,#7a2f60)",
    icon: <path d="m12 3-2 5-5 2 5 2 2 5 2-5 5-2-5-2z" />,
  },
  mehendi: {
    gradient: "linear-gradient(135deg,#b3672c,#7a4419)",
    icon: (
      <path d="M18 11.5V6a2 2 0 0 0-4 0v4M14 9.5V4a2 2 0 0 0-4 0v5.5M10 10V6a2 2 0 0 0-4 0v9M6 13.5V10a2 2 0 0 0-4 0v6a8 8 0 0 0 8 8h1a8 8 0 0 0 8-8v-3a2 2 0 0 0-4 0" />
    ),
  },
  rental: {
    gradient: "linear-gradient(135deg,#57534e,#292524)",
    icon: <path d="M2 20h20M4 20 12 4l8 16M12 4v16M8 20l4-7 4 7" />,
  },
  cake: {
    gradient: "linear-gradient(135deg,#db2777,#9d174d)",
    icon: (
      <path d="M4 21h16M5 21v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6M7 13V9h10v4M12 9V6M12 6c-1 0-1.5-1-1-2l1-1 1 1c.5 1 0 2-1 2zM5 17c2 1 3-1 5 0s3 1 4 0 3-1 5 0" />
    ),
  },
  invitations: {
    gradient: "linear-gradient(135deg,#9a3412,#7c2d12)",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
  },
  transport: {
    gradient: "linear-gradient(135deg,#0369a1,#0c4a6e)",
    icon: (
      <>
        <path d="M5 17H3v-5l2-5h11l3 5h2v5h-2M5 12h16" />
        <circle cx="7.5" cy="17.5" r="2" />
        <circle cx="16.5" cy="17.5" r="2" />
      </>
    ),
  },
  priest: {
    gradient: "linear-gradient(135deg,#ea580c,#9a3412)",
    icon: <path d="M12 2c2 3 4 4.5 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-7zM6 22h12M8 22v-4h8v4" />,
  },
  "event-host": {
    gradient: "linear-gradient(135deg,#7c3aed,#4c1d95)",
    icon: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
      </>
    ),
  },
  "return-gifts": {
    gradient: "linear-gradient(135deg,#be123c,#881337)",
    icon: (
      <>
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M12 8v13M19 12v9H5v-9M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
      </>
    ),
  },
  entertainment: {
    gradient: "linear-gradient(135deg,#a21caf,#701a75)",
    icon: <path d="M12 3l2.5 5.5L20 9.3l-4 4 1 5.7-5-2.8-5 2.8 1-5.7-4-4 5.5-.8z" />,
  },
};

// Neutral visual for categories without their own artwork (instead of
// borrowing the Venue look, which mislabels the vendor).
const FALLBACK_VISUAL: CategoryVisual = {
  gradient: "linear-gradient(135deg,#6b7280,#374151)",
  icon: <path d="M12 3l2.5 5.5L20 9.3l-4 4 1 5.7-5-2.8-5 2.8 1-5.7-4-4 5.5-.8z" />,
};

// Category names whose slug isn't simply the slugified name (migration 004).
const NAME_TO_SLUG: Record<string, string> = {
  "traditional & live arts": "traditional-music",
  "cakes & desserts": "cake",
  "invitations & printing": "invitations",
  "priest & rituals": "priest",
  "gifts & favours": "return-gifts",
  "decoration & florist": "decoration",
  "event host / anchor": "event-host",
};

/** Same rule as migration 004's slug backfill: lower-case, non-alphanumerics -> "-". */
export function categorySlug(nameOrSlug: string): string {
  const lower = nameOrSlug.trim().toLowerCase();
  return NAME_TO_SLUG[lower] ?? lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Visual for a category slug (preferred) or name (legacy vendors.category text). */
export function getCategoryVisual(slugOrName: string): CategoryVisual {
  return CATEGORY_VISUALS[slugOrName] ?? CATEGORY_VISUALS[categorySlug(slugOrName)] ?? FALLBACK_VISUAL;
}

export function VendorTile({
  category,
  slug,
  size = 40,
  className = "",
  opacity = 0.92,
}: {
  /** Category slug or name (legacy). */
  category?: string;
  /** Category slug; wins over `category`. */
  slug?: string;
  size?: number;
  className?: string;
  opacity?: number;
}) {
  const v = getCategoryVisual(slug ?? category ?? "");
  return (
    <div
      className={`flex items-center justify-center shrink-0 ${className}`}
      // A soft top-left highlight gives the flat gradient some depth.
      style={{
        background: `radial-gradient(120% 90% at 20% 0%, rgba(255,255,255,0.16), rgba(255,255,255,0) 55%), ${v.gradient}`,
      }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" opacity={opacity} {...iconProps}>
        {v.icon}
      </svg>
    </div>
  );
}
