import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveStreamableProgram, toThrownError } from "./streamable-effect";

const publicHost = () => ["93.184.216.34"];

const CODE = "abc123";
const SOURCE = `https://streamable.com/${CODE}`;

const apiJson = <T>(body: T, status = 200) =>
  stubFetch(() =>
    Response.json(body, {
      headers: { "content-type": "application/json" },
      status,
    })
  );

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const runVideos = (
  layer: Layer.Layer<FetchDeps>,
  code: string = CODE,
  sourceUrl: string = SOURCE
) =>
  Effect.runPromise(
    Effect.provide(resolveStreamableProgram({ code, sourceUrl }), layer)
  );

const runVideosError = (
  layer: Layer.Layer<FetchDeps>,
  code: string = CODE,
  sourceUrl: string = SOURCE
) =>
  Effect.runPromise(
    Effect.flip(
      Effect.provide(resolveStreamableProgram({ code, sourceUrl }), layer)
    )
  );

describe("streamable-effect", () => {
  test("ranks mp4 renditions best first with labels", async () => {
    const assets = await runVideos(
      layersFor(
        apiJson({
          files: {
            "360p": {
              height: 360,
              url: "https://cdn.example/360.mp4",
              width: 640,
            },
            "720p": {
              height: 720,
              url: "https://cdn.example/720.mp4",
              width: 1280,
            },
          },
          thumbnail_url: "https://cdn.example/thumb.jpg",
          title: "A clip",
        })
      )
    );

    expect(assets.map((a) => [a.label, a.videoUrl])).toEqual([
      ["720p", "https://cdn.example/720.mp4"],
      ["360p", "https://cdn.example/360.mp4"],
    ]);
    expect(assets[0]).toMatchObject({
      platform: "streamable",
      shortcode: CODE,
      sourceUrl: SOURCE,
      thumbnail: "https://cdn.example/thumb.jpg",
      title: "A clip",
    });
  });

  test("collapses a doubled scheme", async () => {
    const [asset] = await runVideos(
      layersFor(
        apiJson({
          files: {
            "720p": { height: 720, url: "https:https://cdn.example/x.mp4" },
          },
        })
      )
    );

    expect(asset?.videoUrl).toBe("https://cdn.example/x.mp4");
  });

  test("reports a post with no files", async () => {
    const error = await runVideosError(layersFor(apiJson({ files: {} })));

    expect(error._tag).toBe("StreamableNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found. Only video posts are downloadable."
    );
  });

  test("reports a missing video", async () => {
    const error = await runVideosError(
      layersFor(apiJson({ error: "gone" }, 404))
    );

    expect(error._tag).toBe("StreamableNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("reports a down upstream", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("boom", { status: 503 })))
    );

    expect(error._tag).toBe("StreamableUpstream");
    expect(toThrownError(error).message).toBe(
      "Streamable returned 503. Try again later."
    );
  });

  test("every tag maps to its legacy message", () => {
    expect(
      toThrownError({ _tag: "StreamableUnexpectedResponse" as const }).message
    ).toBe("Streamable returned an unexpected response. Try again later.");
    expect(
      toThrownError({ _tag: "StreamableUnreachable" as const }).message
    ).toBe("Streamable is unreachable right now. Try again later.");
    expect(
      toThrownError({ _tag: "StreamableBadRedirect" as const }).message
    ).toBe("This link redirects somewhere invalid.");
    expect(
      toThrownError({ _tag: "StreamableTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(
      toThrownError({ _tag: "StreamableGuardBlocked" as const }).message
    ).toBe("Only public links are supported.");
    expect(
      toThrownError({ _tag: "StreamableUnresolved" as const }).message
    ).toBe("Could not resolve this link. Check the URL.");
  });
});
