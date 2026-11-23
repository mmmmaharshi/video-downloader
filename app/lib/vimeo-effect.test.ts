import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveVimeoProgram, toThrownError } from "./vimeo-effect";

const VIMEO_URL = "https://vimeo.com/123456789";
const VIMEO_MP4 = "https://vod-progressive-ak.vimeo.com/v/12345.mp4";
const VIMEO_MP4_HD = "https://vod-progressive-ak.vimeo.com/v/12345_hd.mp4";

const publicHost = () => ["93.184.216.34"];

const vimeoJson = (
  progressive: {
    height?: number;
    quality?: string;
    url: string;
    width?: number;
  }[],
  extra?: { thumbnail_url?: string; title?: string }
) =>
  stubFetch(() =>
    Response.json(
      {
        video: {
          files: { progressive },
          thumbnail_url: "https://i.vimeocdn.com/thumb.jpg",
          title: "vtitle",
          ...extra,
        },
      },
      { headers: { "content-type": "application/json" }, status: 200 }
    )
  );

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const runVideos = (
  layer: Layer.Layer<FetchDeps>,
  id = "123456789",
  sourceUrl: string = VIMEO_URL,
  hash?: string
) =>
  Effect.runPromise(
    Effect.provide(resolveVimeoProgram({ hash, id, sourceUrl }), layer)
  );

const runVideosError = (
  layer: Layer.Layer<FetchDeps>,
  id = "123456789",
  sourceUrl: string = VIMEO_URL,
  hash?: string
) =>
  Effect.runPromise(
    Effect.flip(
      Effect.provide(resolveVimeoProgram({ hash, id, sourceUrl }), layer)
    )
  );

describe("vimeo-effect", () => {
  test("offers every progressive rendition, highest first", async () => {
    const assets = await runVideos(
      layersFor(
        vimeoJson([
          { height: 360, url: VIMEO_MP4, width: 640 },
          { height: 1080, url: VIMEO_MP4_HD, width: 1920 },
        ])
      )
    );

    expect(assets.map((a) => [a.label, a.videoUrl])).toEqual([
      ["1080p", VIMEO_MP4_HD],
      ["360p", VIMEO_MP4],
    ]);

    expect(assets[0]).toMatchObject({
      platform: "vimeo",
      shortcode: "123456789",
      sourceUrl: VIMEO_URL,
      thumbnail: "https://i.vimeocdn.com/thumb.jpg",
      title: "vtitle",
    });
  });

  test("appends the hash to the config url", async () => {
    const seen: string[] = [];

    await runVideos(
      layersFor(
        stubFetch((url) => {
          seen.push(url);

          return Response.json(
            {
              video: {
                files: { progressive: [{ height: 360, url: VIMEO_MP4 }] },
              },
            },
            { headers: { "content-type": "application/json" } }
          );
        })
      ),
      "123456789",
      "https://vimeo.com/123456789/abc123",
      "abc123"
    );

    expect(seen.some((url) => url.includes("h=abc123"))).toBe(true);
  });

  test("falls back to the hls manifest when no progressive file exists", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(() =>
          Response.json(
            { request: { files: { hls: { url: "https://x/master.m3u8" } } } },
            { headers: { "content-type": "application/json" } }
          )
        )
      )
    );

    expect(asset?.videoUrl).toBe("https://x/master.m3u8");
  });

  test("rejects a video with no playable file", async () => {
    const error = await runVideosError(layersFor(vimeoJson([])));

    expect(error._tag).toBe("VimeoNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found. Only public videos are downloadable."
    );
  });

  test("reports an error status", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("busy", { status: 503 })))
    );

    expect(error._tag).toBe("VimeoUpstream");
    expect(toThrownError(error).message).toBe(
      "Vimeo returned 503. Try again later."
    );
  });

  test("reports a missing post", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("gone", { status: 404 })))
    );

    expect(error._tag).toBe("VimeoNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("reports a non-json body", async () => {
    const error = await runVideosError(
      layersFor(
        stubFetch(() => new Response("<!DOCTYPE html>", { status: 200 }))
      )
    );

    expect(error._tag).toBe("VimeoUnexpectedResponse");
    expect(toThrownError(error).message).toBe(
      "Vimeo returned an unexpected response. Try again later."
    );
  });

  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "VimeoUnreachable" as const }).message).toBe(
      "Vimeo is unreachable right now. Try again later."
    );
    expect(toThrownError({ _tag: "VimeoBadRedirect" as const }).message).toBe(
      "This link redirects somewhere invalid."
    );
    expect(
      toThrownError({ _tag: "VimeoTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(toThrownError({ _tag: "VimeoGuardBlocked" as const }).message).toBe(
      "Only public links are supported."
    );
    expect(toThrownError({ _tag: "VimeoUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
