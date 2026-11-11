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

// Every host a platform resolves from. The resolver's matchers implement the
// same list as logic; this copy feeds the fail-fast for known hosts with
// unrecognized paths. One entry per platform is compiler-enforced, so adding
// a platform without its hosts is a type error, not a silent miss. `direct`
// has no hosts: it is the catch-all for everything else.
export const PLATFORM_HOSTS: Record<Platform, readonly string[]> = {
  dailymotion: ["dai.ly", "dailymotion.com"],
  direct: [],
  facebook: ["facebook.com", "fb.watch"],
  instagram: ["instagram.com"],
  loom: ["loom.com"],
  reddit: ["reddit.com", "redd.it"],
  streamable: ["streamable.com"],
  threads: ["threads.com", "threads.net"],
  tiktok: ["tiktok.com"],
  twitter: ["twitter.com", "x.com"],
  vimeo: ["player.vimeo.com", "vimeo.com"],
  youtube: ["youtu.be", "youtube.com"],
};
