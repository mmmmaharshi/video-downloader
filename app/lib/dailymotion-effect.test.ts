import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { resolveDailymotionProgram, toThrownError } from "./dailymotion-effect";
import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";

const publicHost = () => ["93.184.216.34"];

const DM_URL = "https://www.dailymotion.com/video/x8abc123";
const DM_MP4 = "https://cdn.dailymotion.com/v/x8abc123.mp4";
const DM_MP4_HD = "https://cdn.dailymotion.com/v/x8abc123_hd.mp4";
const DM_HLS = "https://cdn.dailymotion.com/v/x8abc123.m3u8";

interface DailymotionFile {
  readonly height?: number;
  readonly quality?: string;
  readonly type?: string;
  readonly url: string;
  readonly width?: number;
}

const dmJson = (
  qualities: { readonly [quality: string]: readonly DailymotionFile[] },
  extra?: {
    readonly poster_url?: string;
    readonly thumbnail_url?: string;
    readonly title?: string;
  }
) =>
  stubFetch(() =>
    Response.json(
      {
        poster_url: extra?.poster_url,
        qualities,
        thumbnail_url: extra?.thumbnail_url,
        title: extra?.title,
      },
      { headers: { "content-type": "application/json" }, status: 200 }
    )
  );

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const runVideos = (
  layer: Layer.Layer<FetchDeps>,
  id = "x8abc123",
  sourceUrl: string = DM_URL
) =>
  Effect.runPromise(
    Effect.provide(resolveDailymotionProgram({ id, sourceUrl }), layer)
  );

const runVideosError = (
  layer: Layer.Layer<FetchDeps>,
  id = "x8abc123",
  sourceUrl: string = DM_URL
) =>
  Effect.runPromise(
    Effect.flip(
      Effect.provide(resolveDailymotionProgram({ id, sourceUrl }), layer)
    )
  );

describe("dailymotion-effect", () => {
  test("offers every quality rung, highest first, with auto last", async () => {
    const assets = await runVideos(
      layersFor(
        dmJson(
          {
            "1080": [{ type: "video/mp4", url: DM_MP4_HD }],
            "240": [{ type: "video/mp4", url: DM_MP4 }],
            auto: [{ type: "application/x-mpegURL", url: DM_HLS }],
          },
          { poster_url: "https://cdn.dailymotion.com/thumb.jpg", title: "dt" }
        )
      )
    );

    expect(assets.map((a) => [a.label, a.videoUrl])).toEqual([
      ["1080p", DM_MP4_HD],
      ["240p", DM_MP4],
      ["auto", DM_HLS],
    ]);

    expect(assets[0]).toMatchObject({
      platform: "dailymotion",
      shortcode: "x8abc123",
      sourceUrl: DM_URL,
      thumbnail: "https://cdn.dailymotion.com/thumb.jpg",
      title: "dt",
    });
  });

  test("rejects a post with no playable file", async () => {
    const error = await runVideosError(layersFor(dmJson({})));

    expect(error._tag).toBe("DailymotionNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found. Only public videos are downloadable."
    );
  });

  test("reports an error status", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("busy", { status: 503 })))
    );

    expect(error._tag).toBe("DailymotionUpstream");
    expect(toThrownError(error).message).toBe(
      "Dailymotion returned 503. Try again later."
    );
  });

  test("reports a missing post", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("gone", { status: 404 })))
    );

    expect(error._tag).toBe("DailymotionNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("every tag maps to its legacy message", () => {
    expect(
      toThrownError({ _tag: "DailymotionUnexpectedResponse" as const }).message
    ).toBe("Dailymotion returned an unexpected response. Try again later.");
    expect(
      toThrownError({ _tag: "DailymotionUnreachable" as const }).message
    ).toBe("Dailymotion is unreachable right now. Try again later.");
    expect(
      toThrownError({ _tag: "DailymotionBadRedirect" as const }).message
    ).toBe("This link redirects somewhere invalid.");
    expect(
      toThrownError({ _tag: "DailymotionTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(
      toThrownError({ _tag: "DailymotionGuardBlocked" as const }).message
    ).toBe("Only public links are supported.");
    expect(
      toThrownError({ _tag: "DailymotionUnresolved" as const }).message
    ).toBe("Could not resolve this link. Check the URL.");
  });
});
