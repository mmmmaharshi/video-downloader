// Module: ResolveQuery — the /api/resolve response contract.
// resolveResultSchema.parse(json) validates the response at the boundary.

import { z } from "zod";

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
