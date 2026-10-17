// Module: Platforms — the client-safe platform vocabulary.
// Split out of MediaResolver so client code (the zod schema in resolve-query)
// never pulls in media-resolver's node:dns / node:net imports, which Vite
// externalizes with a throwing stub in dev and kills hydration.

export const PLATFORMS = [
  "instagram",
  "twitter",
  "youtube",
  "facebook",
  "reddit",
  "streamable",
  "vimeo",
  "tiktok",
  "threads",
  "dailymotion",
  "loom",
  "direct",
] as const;

export type Platform = (typeof PLATFORMS)[number];
