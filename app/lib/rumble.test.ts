import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { resolve as resolveRaw } from "./media-resolver";
import type { MediaResolverDeps } from "./media-resolver";

const publicHost = () => ["93.184.216.34"];

const resolve = (url: string, deps: MediaResolverDeps = {}) =>
  resolveRaw(url, { lookup: publicHost, ...deps });

const WATCH = "https://rumble.com/v1a2b3c-some-title.html";
const EMBED_ID = "v1a2b3c";

const watchPage = () =>
  new Response(
    `<html><head><meta property="og:image" content="https://thumb.example/t.jpg"></head><body><iframe src="https://rumble.com/embed/${EMBED_ID}"></iframe></body></html>`,
    { headers: { "content-type": "text/html" } }
  );

const embedJs = () =>
  Response.json({
    ua: {
      mp4: [
        { meta: { h: 360, w: 640 }, url: "https://cdn.example/v360.mp4" },
        { meta: { h: 1080, w: 1920 }, url: "https://cdn.example/v1080.mp4" },
        { meta: { h: 720, w: 1280 }, url: "https://cdn.example/v720.mp4" },
      ],
    },
  });

const vodFetch = stubFetch((url) => {
  if (url.includes("/embedJS/")) {
    return embedJs();
  }

  return watchPage();
});

describe("rumble", () => {
  test("resolves a VOD to one labeled asset per rung, best first", async () => {
    const assets = await resolve(WATCH, { fetch: vodFetch });

    expect(assets.map((a) => a.label)).toEqual(["1080p", "720p", "360p"]);
    expect(assets[0]).toEqual({
      label: "1080p",
      platform: "rumble",
      shortcode: EMBED_ID,
      sourceUrl: WATCH,
      thumbnail: "https://thumb.example/t.jpg",
      videoUrl: "https://cdn.example/v1080.mp4",
    });
  });

  test("resolves an embed link directly", async () => {
    const assets = await resolve(`https://rumble.com/embed/${EMBED_ID}`, {
      fetch: vodFetch,
    });

    expect(assets).toHaveLength(3);
    expect(assets[0]?.videoUrl).toBe("https://cdn.example/v1080.mp4");
  });

  test("re-sends the RNSC cookie after a 307 to self", async () => {
    const cookies: (string | null)[] = [];

    const fetch = stubFetch((url, init) => {
      if (url.includes("/embedJS/")) {
        return embedJs();
      }

      cookies.push(new Headers(init?.headers).get("cookie"));

      if (cookies.length === 1) {
        return new Response(null, {
          headers: {
            location: WATCH,
            "set-cookie": "RNSC=abc123; Path=/",
          },
          status: 307,
        });
      }

      return watchPage();
    });

    const assets = await resolve(WATCH, { fetch });

    expect(assets).toHaveLength(3);
    expect(cookies[1]).toContain("RNSC=abc123");
  });

  test("fails when the page carries no embed id", async () => {
    await expect(
      resolve(WATCH, {
        fetch: stubFetch(
          () => new Response("<html><body>no video here</body></html>")
        ),
      })
    ).rejects.toThrow("No downloadable video found for this post.");
  });

  test("reports hls-only videos as not downloadable", async () => {
    await expect(
      resolve(WATCH, {
        fetch: stubFetch((url) =>
          url.includes("/embedJS/") ? Response.json({ ua: {} }) : watchPage()
        ),
      })
    ).rejects.toThrow("No downloadable video found for this post.");
  });

  test("fails fast on an unrecognized rumble path", async () => {
    await expect(
      resolve("https://rumble.com/user/someone", { fetch: vodFetch })
    ).rejects.toThrow("only a video post or file link is downloadable");
  });
});
