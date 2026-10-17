import { describe, expect, test } from "bun:test";

import { resolve } from "./media-resolver";
import type { Platform } from "./platforms";

// Live integration checks against real public links. Network-dependent and flaky,
// so they are skipped unless LIVE_LINKS=1 is set.
const LIVE = !!process.env.LIVE_LINKS;

// Curated public URLs known to resolve at time of writing. Add more as they are
// verified; platforms without a stable public URL (instagram, x, facebook,
// reddit, vimeo, tiktok, threads, loom) are intentionally omitted.
const CASES: { platform: Platform; url: string }[] = [
  { platform: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  { platform: "dailymotion", url: "https://www.dailymotion.com/video/xarp0hi" },
  { platform: "streamable", url: "https://streamable.com/yo716e" },
  { platform: "direct", url: "https://placeholdervideo.dev/1920x1080" },
];

describe("resolve (live links)", () => {
  for (const { platform, url } of CASES) {
    test.skipIf(!LIVE)(
      `resolves a ${platform} link`,
      async () => {
        const assets = await resolve(url);
        expect(assets.length).toBeGreaterThan(0);
        expect(assets[0].platform).toBe(platform);
      },
      30_000
    );
  }
});
