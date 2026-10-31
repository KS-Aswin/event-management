// Video link parser (docs/PRODUCT_PLAN.md 4.1 / 4.5). URL patterns only, no
// API keys. Pure: loaded directly by tests/storage.test.mjs.

export type VideoProvider = "youtube" | "instagram" | "vimeo";

export interface ParsedVideoLink {
  provider: VideoProvider;
  id: string;
  /** Canonical URL stored as external_url. */
  url: string;
  /** Keyless thumbnail (YouTube only); null shows a branded card. */
  thumbnailUrl: string | null;
  /** Embed URL, loaded on click (click-to-load). */
  embedUrl: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const IG_ID = /^[A-Za-z0-9_-]{5,64}$/;
const VIMEO_ID = /^[0-9]{3,12}$/;

function youtube(id: string): ParsedVideoLink | null {
  if (!YT_ID.test(id)) return null;
  return {
    provider: "youtube",
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
  };
}

/** Returns null for anything that is not a supported video link. */
export function parseVideoLink(input: unknown): ParsedVideoLink | null {
  if (typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw || raw.length > 500) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") return parts[0] ? youtube(parts[0]) : null;
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") return youtube(u.searchParams.get("v") ?? "");
    if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "") && parts[1]) return youtube(parts[1]);
    return null;
  }

  if (host === "instagram.com") {
    // /reel/ID, /reels/ID, /p/ID, /tv/ID and /{user}/reel/ID
    const idx = parts.findIndex((p) => ["reel", "reels", "p", "tv"].includes(p));
    if (idx === -1 || idx > 1) return null;
    const id = parts[idx + 1];
    if (!id || !IG_ID.test(id)) return null;
    const kind = parts[idx] === "p" ? "p" : "reel";
    return {
      provider: "instagram",
      id,
      url: `https://www.instagram.com/${kind}/${id}/`,
      thumbnailUrl: null,
      embedUrl: `https://www.instagram.com/${kind}/${id}/embed`,
    };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = host === "player.vimeo.com" ? (parts[0] === "video" ? parts[1] : undefined) : [...parts].reverse().find((p) => VIMEO_ID.test(p));
    if (!id || !VIMEO_ID.test(id)) return null;
    return {
      provider: "vimeo",
      id,
      url: `https://vimeo.com/${id}`,
      thumbnailUrl: null,
      embedUrl: `https://player.vimeo.com/video/${id}`,
    };
  }

  return null;
}
