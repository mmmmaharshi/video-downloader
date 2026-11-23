// Module: ResolveQuery — the TanStack Query seam for link resolution.
// Interface: resolveKey(url) → query key; isFresh(updatedAt, now?) → gate check;
// resolveResultSchema.parse(json) validates the /api/resolve response at the boundary.
// Resolved CDN urls go stale, so cached resolutions stay valid only inside
// FRESH_MS — the same window the signed download href lives for, so a cached
// hit can still download.

import { z } from "zod";

import { FRESH_MS } from "./freshness";
import { PLATFORMS } from "./platforms";

const videoAssetSchema = z.object({
  gif: z.enum(["file", "video"]).optional(),
  label: z.string().optional(),
  platform: z.enum(PLATFORMS),
  shortcode: z.string(),
  sourceUrl: z.string(),
  thumbnail: z.string().optional(),
  title: z.string().optional(),
  videoUrl: z.string(),
});

const resolvedAssetSchema = videoAssetSchema.extend({
  downloadHref: z.string(),
});

// One declaration for the fields: the schema is both the wire contract and the
// domain type, so a new field cannot be added to one side only.
export type VideoAsset = z.infer<typeof videoAssetSchema>;

export type ResolvedAsset = z.infer<typeof resolvedAssetSchema>;

export const resolveResultSchema = z.union([
  z.object({ assets: z.array(resolvedAssetSchema) }),
  z.object({ error: z.string() }),
]);

export type ResolveResult = z.infer<typeof resolveResultSchema>;

export const resolveKey = (url: string): readonly ["resolve", string] =>
  ["resolve", url.trim()] as const;

// the download href is same-origin relative; the base only resolves it for
// parsing. The stem is read back here (not rebuilt) so the naming rule stays
// in download-link, which is server-only and cannot be imported by the route.
// A signed href always carries a name, so a missing one is a broken link.
export const stemOf = (href: string): string => {
  const stem = new URL(href, "http://localhost").searchParams.get("name");

  if (!stem) {
    throw new Error("Download link has no name");
  }

  return stem;
};

export const isFresh = (
  dataUpdatedAt: number,
  now: number = Date.now()
): boolean => now - dataUpdatedAt < FRESH_MS;
