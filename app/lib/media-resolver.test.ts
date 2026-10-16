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

  test("accepts the plural /reels/ share shape", async () => {
    const [asset] = await resolve("https://www.instagram.com/reels/DeUJBPLgZeX/", {
      fetch: stubFetch(() => page(`<meta property="og:video" content="${CDN}">`)),
    });
    expect(asset.shortcode).toBe("DeUJBPLgZeX");
    expect(asset.platform).toBe("instagram");
  });

  test("a plural /reels/ url falls back to the singular reel embed", async () => {    const requested: string[] = [];
    const [asset] = await resolve("https://www.instagram.com/reels/DeUJBPLgZeX/", {
      fetch: stubFetch((url) => {
        requested.push(url);
        return url.includes("/embed/")
          ? page(`"video_url":"https:\\/\\/scontent.cdninstagram.com\\/v\\/embed.mp4"`)
          : page("<p>no player here</p>");
      }),
    });
    expect(asset.videoUrl).toBe("https://scontent.cdninstagram.com/v/embed.mp4");
    expect(requested.some((u) => u.includes("/reel/DeUJBPLgZeX/embed/"))).toBe(true);
  });

  test("a plural /reels/ url is fetched as the singular /reel/ form", async () => {
    const requested: string[] = [];
    await resolve("https://www.instagram.com/reels/DeUJBPLgZeX/", {
      fetch: stubFetch((url) => {
        requested.push(url);
        return page(`<meta property="og:video" content="${CDN}">`);
      }),
    });
    expect(requested[0]).toBe("https://www.instagram.com/reel/DeUJBPLgZeX/");
  });

  test("rejects an empty url", async () => {
    await expect(resolve("   ", { fetch: stubFetch(() => page("")) })).rejects.toThrow("Paste a video link");
  });

  test("rejects a page with no video", async () => {
    await expect(resolve("https://example.com/reel/ABC123/", { fetch: stubFetch(() => page("")) })).rejects.toThrow(
      "No video found at this link",
    );
  });

  test("rejects garbage that is not a url", async () => {
    await expect(resolve("not a url", { fetch: stubFetch(() => page("")) })).rejects.toThrow("Invalid URL");
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

// The youtube dep is stubbed: live Innertube traffic belongs in youtube.test.ts, not here.
const YT_ID = "dQw4w9WgXcQ";
const YT_MP4 = "https://rr1---sn-x.googlevideo.com/videoplayback?expire=1";

const tubeOk = (videoUrl = YT_MP4) => async (id: string) => {
  if (id !== YT_ID) throw new Error(`unexpected id ${id}`);
  return [{ videoUrl, height: 720 }];
};

describe("resolve — YouTube", () => {
  test("resolves a watch url to its best mp4 and a deterministic thumbnail", async () => {
    const [asset] = await resolve(`https://www.youtube.com/watch?v=${YT_ID}`, { youtube: tubeOk() });
    expect(asset).toEqual({
      videoUrl: YT_MP4,
      thumbnail: `https://i.ytimg.com/vi/${YT_ID}/hqdefault.jpg`,
      shortcode: YT_ID,
      sourceUrl: `https://www.youtube.com/watch?v=${YT_ID}`,
      platform: "youtube",
      label: "720p",
    });
  });

  test("resolves every supported YouTube url shape to the same id", async () => {
    for (const url of [
      `https://youtu.be/${YT_ID}`,
      `https://www.youtube.com/shorts/${YT_ID}`,
      `https://www.youtube.com/live/${YT_ID}`,
      `https://www.youtube.com/embed/${YT_ID}`,
      `https://m.youtube.com/watch?v=${YT_ID}`,
      `https://www.youtube.com/watch?list=WL&v=${YT_ID}&index=2`,
    ]) {
      const [asset] = await resolve(url, { youtube: tubeOk() });
      expect(asset.shortcode).toBe(YT_ID);
      expect(asset.platform).toBe("youtube");
    }
  });

  test("labels one asset per distinct YouTube rendition, best first", async () => {
    const assets = await resolve(`https://youtu.be/${YT_ID}`, {
      youtube: async () => [
        { videoUrl: "https://x/1080.mp4", height: 1080 },
        { videoUrl: "https://x/1080b.mp4", height: 1080 },
        { videoUrl: "https://x/720.mp4", height: 720 },
      ],
    });
    expect(assets.map((a) => [a.label, a.videoUrl])).toEqual([
      ["1080p", "https://x/1080.mp4"],
      ["720p", "https://x/720.mp4"],
    ]);
  });

  test("carries the YouTube title onto every asset", async () => {
    const [asset] = await resolve(`https://youtu.be/${YT_ID}`, {
      youtube: async () => [{ videoUrl: YT_MP4, height: 720, title: "Never Gonna Give You Up" }],
    });
    expect(asset.title).toBe("Never Gonna Give You Up");
  });
  test("reports no downloadable video when YouTube has no mp4 rendition", async () => {
    await expect(resolve(`https://youtu.be/${YT_ID}`, { youtube: async () => [] })).rejects.toThrow(
      "No downloadable video found",
    );
  });
  test("surfaces YouTube's own failure message", async () => {
    const unavailable = async () => {
      throw new Error("This video is unavailable. Private videos need a login, which is not supported.");
    };
    await expect(resolve(`https://youtu.be/${YT_ID}`, { youtube: unavailable })).rejects.toThrow("not supported");
  });

  test("rejects non-video YouTube urls and malformed ids", async () => {
    for (const url of [
      "https://www.youtube.com/channel/UC1234567890",
      "https://www.youtube.com/playlist?list=WL",
      "https://www.youtube.com/watch?v=short",
      "https://youtu.be/short",
      "https://www.youtube.com/watch",
    ]) {
      await expect(resolve(url, { youtube: tubeOk() })).rejects.toThrow("Invalid URL");
    }
  });
});

// Facebook exposes the file as browser_native_hd/sd_url on the full page
// variant; og:video and hd_src/sd_src are fallbacks.
const FB_REEL = "https://www.facebook.com/reel/1234567890123456/";
const FB_HD = "https://video.fbcdn.net/v/hd.mp4?e=1";
const FB_SD = "https://video.fbcdn.net/v/sd.mp4?e=1";

describe("resolve — Facebook", () => {
  test("prefers browser_native_hd_url, then sd, over og:video", async () => {
    const [asset] = await resolve(FB_REEL, {
      fetch: stubFetch(() =>
        page(`<meta property="og:video" content="https://video.fbcdn.net/v/og.mp4">{"browser_native_hd_url":"${FB_HD}","browser_native_sd_url":"${FB_SD}"}`),
      ),
    });
    expect(asset.videoUrl).toBe(FB_HD);
  });

  test("falls back to browser_native_sd_url without hd", async () => {
    const [asset] = await resolve(FB_REEL, {
      fetch: stubFetch(() => page(`{"browser_native_sd_url":"${FB_SD}"}`)),
    });
    expect(asset.videoUrl).toBe(FB_SD);
  });

  test("falls back to hd_src, preferring it over sd_src", async () => {
    const [asset] = await resolve(FB_REEL, {
      fetch: stubFetch(() => page(`"hd_src":"${FB_HD}","sd_src":"${FB_SD}"`)),
    });
    expect(asset.videoUrl).toBe(FB_HD);
  });

  test("reads thumbnail and asset identity from the reel page", async () => {
    const [asset] = await resolve(FB_REEL, {
      fetch: stubFetch(() =>
        page(`{"browser_native_hd_url":"${FB_HD}"}<meta property="og:image" content="https://img.example/fb.jpg">`),
      ),
    });
    expect(asset).toEqual({
      videoUrl: FB_HD,
      thumbnail: "https://img.example/fb.jpg",
      shortcode: "1234567890123456",
      sourceUrl: FB_REEL,
      platform: "facebook",
    });
  });

  test("resolves every supported Facebook url shape", async () => {
    for (const [url, shortcode] of [
      ["https://www.facebook.com/watch/?v=1234567890123456", "1234567890123456"],
      ["https://www.facebook.com/somepage/videos/1234567890123456/", "1234567890123456"],
      ["https://m.facebook.com/reel/1234567890123456/", "1234567890123456"],
      ["https://fb.watch/AbCdEfGhIjK/", "AbCdEfGhIjK"],
    ] as const) {
      const [asset] = await resolve(url, {
        fetch: stubFetch(() => page(`{"browser_native_hd_url":"${FB_HD}"}`)),
      });
      expect(asset.shortcode).toBe(shortcode);
      expect(asset.platform).toBe("facebook");
    }
  });

  test("ignores login links in page chrome when a video url is present", async () => {
    const [asset] = await resolve(FB_REEL, {
      fetch: stubFetch(() => page(`<a href="/login.php">Log in</a>{"browser_native_hd_url":"${FB_HD}"}`)),
    });
    expect(asset.videoUrl).toBe(FB_HD);
  });

  test("rejects a login redirect", async () => {
    const redirected = {
      status: 200,
      ok: true,
      redirected: true,
      url: "https://www.facebook.com/login.php",
      text: async () => "",
    } as unknown as Response;
    await expect(resolve(FB_REEL, { fetch: stubFetch(() => redirected) })).rejects.toThrow("Private or login-required post");
  });

  test("rejects a page with no video", async () => {
    const noVideo = stubFetch(() => page("<p>just a photo</p>"));
    await expect(resolve(FB_REEL, { fetch: noVideo })).rejects.toThrow("No downloadable video found");
  });

  test("reports a missing post", async () => {
    const notFound = stubFetch(() => new Response("gone", { status: 404 }));
    await expect(resolve(FB_REEL, { fetch: notFound })).rejects.toThrow("Post not found");
  });

  test("reports a non-ok upstream status", async () => {
    const down = stubFetch(() => new Response("boom", { status: 503 }));
    await expect(resolve(FB_REEL, { fetch: down })).rejects.toThrow("Facebook returned 503");
  });
});

// Any other link is fetched generically: a video content-type resolves
// directly, otherwise the page's og:video tag is the last resort.
const MP4_URL = "https://cdn.example.com/clips/funny-cat.mp4?token=abc";

describe("resolve — direct links", () => {
  test("resolves a link that serves video content directly", async () => {
    const [asset] = await resolve(MP4_URL, {
      fetch: stubFetch(() => new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })),
    });
    expect(asset).toEqual({
      videoUrl: MP4_URL,
      thumbnail: undefined,
      shortcode: "funny-cat",
      sourceUrl: MP4_URL,
      platform: "direct",
    });
  });

  test("resolves a page exposing og:video on an unknown host", async () => {
    const pageUrl = "https://blog.example.com/posts/42";
    const [asset] = await resolve(pageUrl, {
      fetch: stubFetch(() =>
        page(`<meta property="og:video:secure_url" content="${MP4_URL}"><meta property="og:image" content="https://img.example/p.jpg">`),
      ),
    });
    expect(asset).toEqual({
      videoUrl: MP4_URL,
      thumbnail: "https://img.example/p.jpg",
      shortcode: "42",
      sourceUrl: pageUrl,
      platform: "direct",
    });
  });

  test("falls back to a safe name when the path has no slug", async () => {
    const [asset] = await resolve("https://cdn.example.com/", {
      fetch: stubFetch(() => new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })),
    });
    expect(asset.shortcode).toBe("video");
  });

  test("survives a malformed percent-escape in the filename", async () => {
    const [asset] = await resolve("https://cdn.example.com/100%.mp4", {
      fetch: stubFetch(() => new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })),
    });
    expect(asset.shortcode).toBe("100%");
  });

  test("reports a missing generic link", async () => {
    const notFound = stubFetch(() => new Response("gone", { status: 404 }));
    await expect(resolve(MP4_URL, { fetch: notFound })).rejects.toThrow("Post not found");
  });

  test("reports a non-ok generic status", async () => {
    const down = stubFetch(() => new Response("busy", { status: 503 }));
    await expect(resolve(MP4_URL, { fetch: down })).rejects.toThrow("returned 503");
  });
});
