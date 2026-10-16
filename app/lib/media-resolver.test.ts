import { describe, expect, test } from "bun:test";
import { stubFetch } from "./fake-fetch";
import { resolve } from "./media-resolver";

const REEL = "https://www.instagram.com/reel/ABC123/";
const CDN = "https://scontent.cdninstagram.com/v/abc.mp4";

const page = (body: string, init?: ResponseInit) => new Response(`<html><head>${body}</head></html>`, { status: 200, ...init });

describe("resolve", () => {
  test("reads video and thumbnail from the post page", async () => {
    const asset = await resolve(REEL, {
      fetch: stubFetch(() =>
        page(`<meta property="og:video:secure_url" content="${CDN}"><meta property="og:image" content="https://img.example/x.jpg">`),
      ),
    });
    expect(asset).toEqual({
      videoUrl: CDN,
      thumbnail: "https://img.example/x.jpg",
      shortcode: "ABC123",
      sourceUrl: REEL,
    });
  });

  test("unescapes \\u0026 and &amp; in the extracted url", async () => {
    const asset = await resolve(REEL, {
      fetch: stubFetch(() => page(`<meta property="og:video" content="${CDN}?e=1\\u0026v=2&amp;t=3">`)),
    });
    expect(asset.videoUrl).toBe(`${CDN}?e=1&v=2&t=3`);
  });

  test("falls back to the embed page when the post page has no video tag", async () => {
    const asset = await resolve(REEL, {
      fetch: stubFetch((url) =>
        url.includes("/embed/")
          ? page(`"video_url":"https:\\/\\/scontent.cdninstagram.com\\/v\\/embed.mp4"`)
          : page("<p>no player here</p>"),
      ),
    });
    expect(asset.videoUrl).toBe("https://scontent.cdninstagram.com/v/embed.mp4");
  });

  test("trims the pasted url", async () => {
    const asset = await resolve(`  ${REEL}  `, {
      fetch: stubFetch(() => page(`<meta property="og:video" content="${CDN}">`)),
    });
    expect(asset.sourceUrl).toBe(REEL);
  });

  test("rejects an empty url", async () => {
    await expect(resolve("   ", { fetch: stubFetch(() => page("")) })).rejects.toThrow("Paste an Instagram URL");
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
