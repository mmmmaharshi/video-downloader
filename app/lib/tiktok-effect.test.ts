import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveTikTokProgram, toThrownError } from "./tiktok-effect";

const publicHost = () => ["93.184.216.34"];

const TIKTOK_URL = "https://www.tiktok.com/@user/video/7123456789";
const TIKTOK_MP4 = "https://v16-webapp-prime.tiktok.com/video/tos/.../abc.mp4";
const TIKTOK_COVER = "https://p16-sign.tiktokcdn-us.com/cover.jpg";

const rehydration = (video: {
  cover?: string;
  downloadAddr?: string;
  playAddr?: string;
}) =>
  `<html><head></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(
    {
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": { itemInfo: { itemStruct: { video } } },
      },
    }
  )}</script></body></html>`;

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const runVideos = (
  layer: Layer.Layer<FetchDeps>,
  sourceUrl: string = TIKTOK_URL,
  id = "7123456789"
) =>
  Effect.runPromise(
    Effect.provide(resolveTikTokProgram({ id, sourceUrl }), layer)
  );

const runVideosError = (
  layer: Layer.Layer<FetchDeps>,
  sourceUrl: string = TIKTOK_URL,
  id = "7123456789"
) =>
  Effect.runPromise(
    Effect.flip(Effect.provide(resolveTikTokProgram({ id, sourceUrl }), layer))
  );

describe("tiktok-effect", () => {
  test("reads playAddr and cover from rehydration json", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(
          () =>
            new Response(
              rehydration({ cover: TIKTOK_COVER, playAddr: TIKTOK_MP4 }),
              { status: 200 }
            )
        )
      )
    );

    expect(asset).toEqual({
      platform: "tiktok",
      shortcode: "7123456789",
      sourceUrl: TIKTOK_URL,
      thumbnail: TIKTOK_COVER,
      videoUrl: TIKTOK_MP4,
    });
  });

  test("falls back to downloadAddr", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(
          () =>
            new Response(rehydration({ downloadAddr: TIKTOK_MP4 }), {
              status: 200,
            })
        )
      )
    );

    expect(asset?.videoUrl).toBe(TIKTOK_MP4);
  });

  test("falls back to og:video when rehydration is missing", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(
          () =>
            new Response(
              `<html><head><meta property="og:video" content="${TIKTOK_MP4}"><meta property="og:image" content="${TIKTOK_COVER}"></head></html>`,
              { status: 200 }
            )
        )
      )
    );

    expect(asset?.videoUrl).toBe(TIKTOK_MP4);
    expect(asset?.thumbnail).toBe(TIKTOK_COVER);
  });

  test("rejects when no video found", async () => {
    const error = await runVideosError(
      layersFor(
        stubFetch(
          () => new Response("<html><body></body></html>", { status: 200 })
        )
      )
    );

    expect(error._tag).toBe("TikTokNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found. Only public videos are downloadable, and TikTok limits anonymous access."
    );
  });

  test("reports an error status", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("busy", { status: 503 })))
    );

    expect(error._tag).toBe("TikTokUpstream");
    expect(toThrownError(error).message).toBe(
      "TikTok returned 503. Try again later."
    );
  });

  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "TikTokNotFound" as const }).message).toBe(
      "Post not found. Check the URL."
    );
    expect(toThrownError({ _tag: "TikTokUnreachable" as const }).message).toBe(
      "TikTok is unreachable right now. Try again later."
    );
    expect(toThrownError({ _tag: "TikTokGuardBlocked" as const }).message).toBe(
      "Only public links are supported."
    );
    expect(toThrownError({ _tag: "TikTokUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
