// Module: ResolveQuery — the TanStack Query seam for link resolution.
// Interface: resolveKey(url) → query key; isFresh(updatedAt, now?) → gate check.
// Resolved CDN urls go stale, so cached resolutions stay valid only inside
// FRESH_MS — the same window recent-resolves honors at the download gate, so a
// cached hit can still download.

import type { VideoAsset } from "./media-resolver";

export type ResolveResult =
  | { assets: VideoAsset[]; inputUrl: string; error?: never }
  | { error: string; inputUrl: string; assets?: never };

export const FRESH_MS = 10 * 60_000;

export function resolveKey(url: string): readonly ["resolve", string] {
  return ["resolve", url.trim()] as const;
}

export function isFresh(dataUpdatedAt: number, now: number = Date.now()): boolean {
  return now - dataUpdatedAt < FRESH_MS;
}
