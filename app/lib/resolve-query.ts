// Module: ResolveQuery — the /api/resolve response contract.
// resolveResultSchema decodes the response at the boundary.

import { Schema } from "effect";

import { PLATFORMS } from "./platforms";

// The asset fields, exported so the client's Schema derives from the same
// declaration instead of restating it.
export const videoAssetFields = {
  gif: Schema.optional(Schema.Literals(["file", "video"])),
  label: Schema.optional(Schema.String),
  platform: Schema.Literals([...PLATFORMS]),
  shortcode: Schema.String,
  sourceUrl: Schema.String,
  thumbnail: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  videoUrl: Schema.String,
};

const videoAssetSchema = Schema.Struct(videoAssetFields);

export const resolvedAssetSchema = Schema.Struct({
  ...videoAssetFields,
  downloadHref: Schema.String,
});

// One declaration for the fields: the schema is both the wire contract and the
// domain type, so a new field cannot be added to one side only.
export type VideoAsset = typeof videoAssetSchema.Type;

export const resolveResultSchema = Schema.Union([
  Schema.Struct({ assets: Schema.Array(resolvedAssetSchema) }),
  Schema.Struct({ error: Schema.String }),
]);

export type ResolveResult = typeof resolveResultSchema.Type;
