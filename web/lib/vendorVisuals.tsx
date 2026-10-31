export const CATEGORIES = [
  "Venue",
  "Photography",
  "Catering",
  "Decoration",
  "DJ & Music",
  "Makeup",
  "Mehendi",
] as const;

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

export const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  Venue: {
    gradient: "linear-gradient(135deg,#12855f,#0b5940)",
    icon: (
      <path d="M4 21h16M6 21V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v15M9.5 9h1M13.5 9h1M9.5 13h1M13.5 13h1M9.5 17h1M13.5 17h1" />
    ),
  },
  Photography: {
    gradient: "linear-gradient(135deg,#4b5563,#1f2937)",
    icon: (
      <>
        <path d="M22 18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5L9 4h6l1.5 2H20a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
  },
  Catering: {
    gradient: "linear-gradient(135deg,#c2760f,#8a4e0a)",
    icon: <path d="M4 3v6a2 2 0 0 0 2 2v10M4 3v6M8 3v6M6 11V3M17 3c-1.5 0-3 1.5-3 4v4a2 2 0 0 0 2 2v8M17 3v18" />,
  },
  Decoration: {
    gradient: "linear-gradient(135deg,#c2477a,#8f2f56)",
    icon: (
      <>
        <path d="M12 12a4 4 0 1 1 4-4h-4zM12 12a4 4 0 1 0-4-4h4zM12 12v2m-4-2a4 4 0 1 0 4 4v-4zm8 0a4 4 0 1 1-4 4v-4z" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
  },
  "DJ & Music": {
    gradient: "linear-gradient(135deg,#5b3fae,#37276f)",
    icon: (
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
  },
  Makeup: {
    gradient: "linear-gradient(135deg,#c2478f,#7a2f60)",
    icon: <path d="m12 3-2 5-5 2 5 2 2 5 2-5 5-2-5-2z" />,
  },
  Mehendi: {
    gradient: "linear-gradient(135deg,#b3672c,#7a4419)",
    icon: (
      <path d="M18 11.5V6a2 2 0 0 0-4 0v4M14 9.5V4a2 2 0 0 0-4 0v5.5M10 10V6a2 2 0 0 0-4 0v9M6 13.5V10a2 2 0 0 0-4 0v6a8 8 0 0 0 8 8h1a8 8 0 0 0 8-8v-3a2 2 0 0 0-4 0" />
    ),
  },
};

// Neutral visual for categories without their own artwork (instead of
// borrowing the Venue look, which mislabels the vendor).
const FALLBACK_VISUAL: CategoryVisual = {
  gradient: "linear-gradient(135deg,#6b7280,#374151)",
  icon: <path d="M12 3l2.5 5.5L20 9.3l-4 4 1 5.7-5-2.8-5 2.8 1-5.7-4-4 5.5-.8z" />,
};

function getVisual(category: string): CategoryVisual {
  return CATEGORY_VISUALS[category] ?? FALLBACK_VISUAL;
}

export function VendorTile({
  category,
  size = 40,
  className = "",
  opacity = 0.92,
}: {
  category: string;
  size?: number;
  className?: string;
  opacity?: number;
}) {
  const v = getVisual(category);
  return (
    <div
      className={`flex items-center justify-center shrink-0 ${className}`}
      // A soft top-left highlight gives the flat gradient some depth.
      style={{
        background: `radial-gradient(120% 90% at 20% 0%, rgba(255,255,255,0.16), rgba(255,255,255,0) 55%), ${v.gradient}`,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" opacity={opacity} {...iconProps}>
        {v.icon}
      </svg>
    </div>
  );
}
