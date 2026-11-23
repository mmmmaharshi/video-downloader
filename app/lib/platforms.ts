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
  "rumble",
  "direct",
] as const;

export type Platform = (typeof PLATFORMS)[number];

// Every host a platform resolves from. Matchers and the fail-fast both read
// this list through hostMatches/isPlatformHost, so one edit makes a host
// recognizable everywhere. One entry per platform is compiler-enforced;
// `direct` has no hosts because it is the catch-all.
export const PLATFORM_HOSTS: Record<Platform, readonly string[]> = {
  dailymotion: ["dai.ly", "dailymotion.com"],
  direct: [],
  facebook: ["facebook.com", "fb.watch"],
  instagram: ["instagram.com"],
  loom: ["loom.com"],
  reddit: ["reddit.com", "redd.it"],
  rumble: ["rumble.com"],
  streamable: ["streamable.com"],
  threads: ["threads.com", "threads.net"],
  tiktok: ["tiktok.com"],
  twitter: ["twitter.com", "x.com"],
  vimeo: ["player.vimeo.com", "vimeo.com"],
  youtube: ["youtu.be", "youtube.com"],
};

// The one host rule: exact host or any subdomain of a listed host. Matchers
// reuse it so a host added here also becomes recognizable by its resolver.
export const hostMatches = (platform: Platform, hostname: string): boolean =>
  PLATFORM_HOSTS[platform].some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  );

export const isPlatformHost = (hostname: string): boolean =>
  PLATFORMS.some((platform) => hostMatches(platform, hostname));
