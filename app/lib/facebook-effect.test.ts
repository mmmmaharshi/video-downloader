import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { resolveFacebookProgram, toThrownError } from "./facebook-effect";
import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";

const FB_REEL = "https://www.facebook.com/reel/1234567890123456/";
const FB_HD = "https://video.fbcdn.net/v/hd.mp4?e=1";
const FB_SD = "https://video.fbcdn.net/v/sd.mp4?e=1";

const publicHost = () => ["93.184.216.34"];

const page = (body: string, init?: ResponseInit) =>
  new Response(`<html><head>${body}</head></html>`, { status: 200, ...init });

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const runVideos = (
  layer: Layer.Layer<FetchDeps>,
  fetchUrl: string = FB_REEL,
  id = "1234567890123456",
  sourceUrl: string = FB_REEL
) =>
  Effect.runPromise(
    Effect.provide(resolveFacebookProgram({ fetchUrl, id, sourceUrl }), layer)
  );

const runVideosError = (
  layer: Layer.Layer<FetchDeps>,
  fetchUrl: string = FB_REEL,
  id = "1234567890123456",
  sourceUrl: string = FB_REEL
) =>
  Effect.runPromise(
    Effect.flip(
      Effect.provide(resolveFacebookProgram({ fetchUrl, id, sourceUrl }), layer)
    )
  );

describe("facebook-effect", () => {
  test("prefers browser_native_hd_url, then sd, over og:video", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(() =>
          page(
            `<meta property="og:video" content="https://video.fbcdn.net/v/og.mp4">{"browser_native_hd_url":"${FB_HD}","browser_native_sd_url":"${FB_SD}"}`
          )
        )
      )
    );

    expect(asset?.videoUrl).toBe(FB_HD);
  });

  test("offers the hd and sd rungs when the page carries both", async () => {
    const assets = await runVideos(
      layersFor(
        stubFetch(() =>
          page(
            `{"browser_native_hd_url":"${FB_HD}","browser_native_sd_url":"${FB_SD}"}`
          )
        )
      )
    );

    expect(assets.map((a) => [a.label, a.videoUrl])).toEqual([
      ["HD", FB_HD],
      ["SD", FB_SD],
    ]);
  });

  test("falls back to browser_native_sd_url without hd", async () => {
    const [asset] = await runVideos(
      layersFor(stubFetch(() => page(`{"browser_native_sd_url":"${FB_SD}"}`)))
    );

    expect(asset?.videoUrl).toBe(FB_SD);
    expect(asset?.label).toBeUndefined();
  });

  test("falls back to hd_src, preferring it over sd_src", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(() => page(`"hd_src":"${FB_HD}","sd_src":"${FB_SD}"`))
      )
    );

    expect(asset?.videoUrl).toBe(FB_HD);
  });

  test("reads thumbnail and asset identity from the reel page", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(() =>
          page(
            `{"browser_native_hd_url":"${FB_HD}"}<meta property="og:image" content="https://img.example/fb.jpg">`
          )
        )
      )
    );

    expect(asset).toEqual({
      label: "HD",
      platform: "facebook",
      shortcode: "1234567890123456",
      sourceUrl: FB_REEL,
      thumbnail: "https://img.example/fb.jpg",
      videoUrl: FB_HD,
    });
  });

  test("ignores login links in page chrome when a video url is present", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(() =>
          page(
            `<a href="/login.php">Log in</a>{"browser_native_hd_url":"${FB_HD}"}`
          )
        )
      )
    );

    expect(asset?.videoUrl).toBe(FB_HD);
  });

  test("rejects a login redirect", async () => {
    const redirected = new Response("", { status: 200 });

    Object.defineProperties(redirected, {
      redirected: { value: true },
      url: { value: "https://www.facebook.com/login.php" },
    });

    const error = await runVideosError(layersFor(stubFetch(() => redirected)));

    expect(error._tag).toBe("FacebookLoginRedirect");
    expect(toThrownError(error).message).toBe(
      "Private or login-required post. Only public posts are supported."
    );
  });

  test("rejects a page with no video", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => page("<p>just a photo</p>")))
    );

    expect(error._tag).toBe("FacebookNoVideo");
    expect(toThrownError(error).message).toBe(
      "No downloadable video found. Only public video/reel posts work, and Facebook limits anonymous access to some of them."
    );
  });

  test("reports a missing post", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("gone", { status: 404 })))
    );

    expect(error._tag).toBe("FacebookNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("reports a non-ok upstream status", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("boom", { status: 503 })))
    );

    expect(error._tag).toBe("FacebookUpstream");
    expect(toThrownError(error).message).toBe(
      "Facebook returned 503. Try again later."
    );
  });

  test("refuses a private host with a typed guard failure", async () => {
    const privateLayer = Layer.succeed(FetchDeps)({
      doFetch: stubFetch(() => page("")),
      lookup: () => ["127.0.0.1"],
    });

    const error = await runVideosError(privateLayer);

    expect(error._tag).toBe("FacebookGuardBlocked");
    expect(toThrownError(error).message).toBe(
      "Only public links are supported."
    );
  });

  test("every tag maps to its legacy message", () => {
    expect(
      toThrownError({ _tag: "FacebookUnreachable" as const }).message
    ).toBe("Facebook is unreachable right now. Try again later.");
    expect(toThrownError({ _tag: "FacebookUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
    expect(
      toThrownError({ _tag: "FacebookUpstream", status: 500 } as const).message
    ).toBe("Facebook returned 500. Try again later.");
  });
});
