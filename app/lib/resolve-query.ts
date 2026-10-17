// Module: ResolveQuery — the TanStack Query seam for link resolution.
// Interface: resolveKey(url) → query key; isFresh(updatedAt, now?) → gate check;
// resolveResultSchema.parse(json) validates the /api/resolve response at the boundary.
// Resolved CDN urls go stale, so cached resolutions stay valid only inside
// FRESH_MS — the same window recent-resolves honors at the download gate, so a
// cached hit can still download.

import { z } from "zod";

import { PLATFORMS } from "./platforms";

const videoAssetSchema = z.object({
  label: z.string().optional(),
  platform: z.enum(PLATFORMS),
  shortcode: z.string(),
  sourceUrl: z.string(),
  thumbnail: z.string().optional(),
  title: z.string().optional(),
  videoUrl: z.string(),
});

export const resolveResultSchema = z.union([
  z.object({
    assets: z.array(videoAssetSchema),
    inputUrl: z.string(),
  }),
  z.object({
    error: z.string(),
    inputUrl: z.string(),
  }),
]);

export type ResolveResult = z.infer<typeof resolveResultSchema>;

export const FRESH_MS = 10 * 60_000;

export const resolveKey = (url: string): readonly ["resolve", string] =>
  ["resolve", url.trim()] as const;

export const isFresh = (
  dataUpdatedAt: number,
  now: number = Date.now()
): boolean => now - dataUpdatedAt < FRESH_MS;
