// Module: ResolveQuery — the TanStack Query seam for link resolution.
// Interface: resolveKey(url) → query key; isFresh(updatedAt, now?) → gate check;
// resolveResultSchema.parse(json) validates the /api/resolve response at the boundary.
// Resolved CDN urls go stale, so cached resolutions stay valid only inside
// FRESH_MS — the same window the signed download href lives for, so a cached
// hit can still download.

import { z } from "zod";

import { FRESH_MS } from "./freshness";
import type { VideoAsset } from "./media-resolver";
import { PLATFORMS } from "./platforms";

const videoAssetSchema = z.object({
  downloadHref: z.string(),
  label: z.string().optional(),
  platform: z.enum(PLATFORMS),
  shortcode: z.string(),
  sourceUrl: z.string(),
  thumbnail: z.string().optional(),
  title: z.string().optional(),
  videoUrl: z.string(),
});

// the wire shape: the domain asset plus the signed href the client follows
export type ResolvedAsset = VideoAsset & { downloadHref: string };

export const resolveResultSchema = z.union([
  z.object({ assets: z.array(videoAssetSchema) }),
  z.object({ error: z.string() }),
]);

export type ResolveResult = z.infer<typeof resolveResultSchema>;

export const resolveKey = (url: string): readonly ["resolve", string] =>
  ["resolve", url.trim()] as const;

export const isFresh = (
  dataUpdatedAt: number,
  now: number = Date.now()
): boolean => now - dataUpdatedAt < FRESH_MS;
