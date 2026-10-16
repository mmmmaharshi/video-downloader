import { describe, expect, test } from "bun:test";
import { stubFetch } from "./fake-fetch";
import { resolve } from "./media-resolver";

const REEL = "https://www.instagram.com/reel/ABC123/";
const CDN = "https://scontent.cdninstagram.com/v/abc.mp4";

const page = (body: string, init?: ResponseInit) => new Response(`<html><head>${body}</head></html>`, { status: 200, ...init });

describe("resolve", () => {
  test("reads video and thumbnail from the post page", async () => {
    const [asset] = await resolve(REEL, {
      fetch: stubFetch(() =>
        page(`<meta property="og:video:secure_url" content="${CDN}"><meta property="og:image" content="https://img.example/x.jpg">`),
      ),
    });
    expect(asset).toEqual({
      videoUrl: CDN,
      thumbnail: "https://img.example/x.jpg",
      shortcode: "ABC123",
      sourceUrl: REEL,
      platform: "instagram",
    });
  });

  test("unescapes \\u0026 and &amp; in the extracted url", async () => {
    const [asset] = await resolve(REEL, {
      fetch: stubFetch(() => page(`<meta property="og:video" content="${CDN}?e=1\\u0026v=2&amp;t=3">`)),
    });
    expect(asset.videoUrl).toBe(`${CDN}?e=1&v=2&t=3`);
  });

  test("falls back to the embed page when the post page has no video tag", async () => {
    const [asset] = await resolve(REEL, {
      fetch: stubFetch((url) =>
        url.includes("/embed/")
          ? page(`"video_url":"https:\\/\\/scontent.cdninstagram.com\\/v\\/embed.mp4"`)
          : page("<p>no player here</p>"),
      ),
    });
    expect(asset.videoUrl).toBe("https://scontent.cdninstagram.com/v/embed.mp4");
  });

  test("trims the pasted url", async () => {
    const [asset] = await resolve(`  ${REEL}  `, {
      fetch: stubFetch(() => page(`<meta property="og:video" content="${CDN}">`)),
    });
    expect(asset.sourceUrl).toBe(REEL);
  });

  test("rejects an empty url", async () => {
    await expect(resolve("   ", { fetch: stubFetch(() => page("")) })).rejects.toThrow("Paste an Instagram or X link");
  });

  test("rejects a non-instagram url", async () => {
    await expect(resolve("https://example.com/reel/ABC123/", { fetch: stubFetch(() => page("")) })).rejects.toThrow(
      "Invalid URL",
    );
  });

  test("rejects a missing post", async () => {
    const notFound = stubFetch(() => new Response("gone", { status: 404 }));
    await expect(resolve(REEL, { fetch: notFound })).rejects.toThrow("Post not found. Check the URL.");
  });

  test("rejects a login redirect", async () => {
    // Response.url and .redirected are read-only, so the fixture supplies them directly
    const redirected = {
      status: 200,
      ok: true,
      redirected: true,
      url: "https://www.instagram.com/accounts/login/",
      text: async () => "",
    } as unknown as Response;
    await expect(resolve(REEL, { fetch: stubFetch(() => redirected) })).rejects.toThrow("Private or login-required post");
  });

  test("rejects a login wall in the html", async () => {
    const walled = stubFetch(() => page(`<a href="/accounts/login/">Log in</a>`));
    await expect(resolve(REEL, { fetch: walled })).rejects.toThrow("Private post or requires login");
  });

  test("rejects a post with no video", async () => {
    const noVideo = stubFetch(() => page("<p>just a photo</p>"));
    await expect(resolve(REEL, { fetch: noVideo })).rejects.toThrow("No video found");
  });

  test("reports a non-ok upstream status", async () => {
    const down = stubFetch(() => new Response("boom", { status: 503 }));
    await expect(resolve(REEL, { fetch: down })).rejects.toThrow("Instagram returned 503");
  });
});

// Fixtures copied from live cdn.syndication.twimg.com responses
const TWEET = "https://x.com/pressmanc/status/2006763209378922836";
const POSTER = "https://pbs.twimg.com/amplify_video_thumb/2006763055372271616/img/N9cPDOrH7L72WaTi.jpg";
const BEST_MP4 = "https://video.twimg.com/amplify_video/2006763055372271616/vid/avc1/1920x1080/9LGsQpvaGMJD8_Yp.mp4";
const GIF_MP4 = "https://video.twimg.com/tweet_video/DOo8AEAX2l.mp4";

const syndication = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const videoMedia = {
  type: "video",
  media_url_https: POSTER,
  video_info: {
    variants: [
      { content_type: "application/x-mpegURL", url: "https://video.twimg.com/amplify_video/2006763055372271616/pl/RjNj4QNxUJ5d3cAJ.m3u8?v=cfc" },
      { bitrate: 256000, content_type: "video/mp4", url: "https://video.twimg.com/vid/avc1/480x270/a.mp4" },
      { bitrate: 10368000, content_type: "video/mp4", url: BEST_MP4 },
      { bitrate: 832000, content_type: "video/mp4", url: "https://video.twimg.com/vid/avc1/640x360/b.mp4" },
    ],
  },
};

describe("resolve — X/Twitter", () => {
  test("picks the highest-bitrate mp4 and the poster as thumbnail", async () => {
    const [asset] = await resolve(TWEET, { fetch: stubFetch(() => syndication({ id_str: "2006763209378922836", mediaDetails: [videoMedia] })) });
    expect(asset).toEqual({
      videoUrl: BEST_MP4,
      thumbnail: POSTER,
      shortcode: "2006763209378922836",
      sourceUrl: TWEET,
      platform: "twitter",
    });
  });

  test("resolves every video in a multi-video tweet, best mp4 each, in post order", async () => {
    const second = {
      type: "video",
      media_url_https: "https://pbs.twimg.com/thumb2.jpg",
      video_info: {
        variants: [
          { bitrate: 5000000, content_type: "video/mp4", url: "https://video.twimg.com/second-hi.mp4" },
          { bitrate: 500000, content_type: "video/mp4", url: "https://video.twimg.com/second-lo.mp4" },
        ],
      },
    };
    const assets = await resolve(TWEET, {
      fetch: stubFetch(() => syndication({ id_str: "2006763209378922836", mediaDetails: [videoMedia, second] })),
    });
    expect(assets.map((a) => a.videoUrl)).toEqual([BEST_MP4, "https://video.twimg.com/second-hi.mp4"]);
    expect(assets.map((a) => a.thumbnail)).toEqual([POSTER, "https://pbs.twimg.com/thumb2.jpg"]);
  });

  test("skips a video entry with no mp4 variant", async () => {
    const m3u8Only = {
      type: "video",
      video_info: { variants: [{ content_type: "application/x-mpegURL", url: "https://video.twimg.com/x.m3u8" }] },
    };
    const assets = await resolve(TWEET, {
      fetch: stubFetch(() => syndication({ id_str: "1", mediaDetails: [m3u8Only, videoMedia] })),
    });
    expect(assets.map((a) => a.videoUrl)).toEqual([BEST_MP4]);
  });

  test("resolves every supported X url shape", async () => {
    for (const url of [
      "https://twitter.com/pressmanc/status/2006763209378922836",
      "https://x.com/i/status/2006763209378922836/video/1",
      "https://www.x.com/pressmanc/status/2006763209378922836?s=20",
      "https://mobile.twitter.com/pressmanc/status/2006763209378922836",
    ]) {
      const [asset] = await resolve(url, { fetch: stubFetch(() => syndication({ id_str: "2006763209378922836", mediaDetails: [videoMedia] })) });
      expect(asset.shortcode).toBe("2006763209378922836");
      expect(asset.platform).toBe("twitter");
    }
  });

  test("asks the syndication endpoint for the tweet id", async () => {
    let requested = "";
    await resolve(TWEET, {
      fetch: stubFetch((url) => {
        requested = url;
        return syndication({ id_str: "2006763209378922836", mediaDetails: [videoMedia] });
      }),
    });
    const u = new URL(requested);
    expect(`${u.origin}${u.pathname}`).toBe("https://cdn.syndication.twimg.com/tweet-result");
    expect(u.searchParams.get("id")).toBe("2006763209378922836");
    expect(u.searchParams.get("token")).toBeTruthy();
  });

  test("rejects a tweet with only photos", async () => {
    const photo = { type: "photo", media_url_https: "https://pbs.twimg.com/media/x.jpg" };
    await expect(resolve(TWEET, { fetch: stubFetch(() => syndication({ id_str: "1", mediaDetails: [photo] })) })).rejects.toThrow(
      "No video found",
    );
  });

  test("rejects a text-only tweet", async () => {
    await expect(resolve(TWEET, { fetch: stubFetch(() => syndication({ id_str: "1", text: "hi" })) })).rejects.toThrow("No video found");
  });

  test("reports a missing tweet", async () => {
    const missing = stubFetch(() => new Response("<!DOCTYPE html><html>", { status: 404, headers: { "content-type": "text/html" } }));
    await expect(resolve(TWEET, { fetch: missing })).rejects.toThrow("Post not found");
  });

  test("reports an X error status", async () => {
    await expect(resolve(TWEET, { fetch: stubFetch(() => new Response("busy", { status: 503 })) })).rejects.toThrow("X returned 503");
  });

  test("reports a non-json body instead of crashing", async () => {
    const html = stubFetch(() => new Response("<!DOCTYPE html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(resolve(TWEET, { fetch: html })).rejects.toThrow("X returned an unexpected response");
  });

  test("reports an unexpected empty payload", async () => {
    await expect(resolve(TWEET, { fetch: stubFetch(() => syndication({})) })).rejects.toThrow("X returned an unexpected response");
  });

  test("accepts an animated gif, whose only mp4 carries bitrate 0", async () => {
    const gif = { type: "animated_gif", video_info: { variants: [{ bitrate: 0, content_type: "video/mp4", url: GIF_MP4 }] } };
    const [asset] = await resolve(TWEET, { fetch: stubFetch(() => syndication({ id_str: "1", mediaDetails: [gif] })) });
    expect(asset.videoUrl).toBe(GIF_MP4);
  });

  test("accepts the sole mp4 when the variant omits bitrate", async () => {
    const video = { type: "video", video_info: { variants: [{ content_type: "video/mp4", url: GIF_MP4 }] } };
    const [asset] = await resolve(TWEET, { fetch: stubFetch(() => syndication({ id_str: "1", mediaDetails: [video] })) });
    expect(asset.videoUrl).toBe(GIF_MP4);
  });

  test("rejects a status id with trailing junk instead of resolving the wrong tweet", async () => {
    await expect(
      resolve("https://x.com/pressmanc/status/2006763209378922836junk", { fetch: stubFetch(() => syndication({})) }),
    ).rejects.toThrow("Invalid URL");
  });
});
