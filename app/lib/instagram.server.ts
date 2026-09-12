// adapter: shallow seam — forwards to deep MediaResolver module
// prefer: import { resolve } from "./media-resolver"
export { resolve as extractVideoUrl } from "./media-resolver";
export type { VideoAsset } from "./media-resolver";

const INSTA_RE = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?(\?.*)?$/;

export function validateInstaUrl(url: string): { shortcode: string } | { error: string } {
  const trimmed = url.trim();
  if (!trimmed) return { error: "Paste an Instagram URL" };
  const m = trimmed.match(INSTA_RE);
  if (!m) return { error: "Invalid URL. Use https://instagram.com/reel/… or /p/…" };
  return { shortcode: m[3] };
}
