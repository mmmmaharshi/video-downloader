import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveGenericProgram, toThrownError } from "./generic-effect";

const publicHost = () => ["93.184.216.34"];

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const MP4_URL = "https://cdn.example.com/clips/funny-cat.mp4?token=abc";

const runVideos = (
  layer: Layer.Layer<FetchDeps>,
  sourceUrl: string = MP4_URL
) =>
  Effect.runPromise(
    Effect.provide(resolveGenericProgram({ sourceUrl }), layer)
  );

const runVideosError = (
  layer: Layer.Layer<FetchDeps>,
  sourceUrl: string = MP4_URL
) =>
  Effect.runPromise(
    Effect.flip(Effect.provide(resolveGenericProgram({ sourceUrl }), layer))
  );

describe("generic-effect", () => {
  test("resolves a video content-type without buffering the body", async () => {
    let cancelled = false;

    // Bun may prime the pump before cancel lands; what matters is the program
    // never consumes the body itself and always releases the connection.
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x"));
      },
    });

    const [asset] = await runVideos(
      layersFor(
        stubFetch(
          () =>
            new Response(body, {
              headers: { "content-type": "video/mp4" },
            })
        )
      )
    );

    expect(asset).toEqual({
      gif: undefined,
      platform: "direct",
      shortcode: "funny-cat",
      sourceUrl: MP4_URL,
      thumbnail: undefined,
      videoUrl: MP4_URL,
    });
    expect(cancelled).toBe(true);
  });

  test("recognizes a gif file by content-type", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(
          () =>
            new Response("bytes", { headers: { "content-type": "image/gif" } })
        )
      )
    );

    expect(asset?.gif).toBe("file");
  });

  test("falls back to og:video on a page", async () => {
    const [asset] = await runVideos(
      layersFor(
        stubFetch(
          () =>
            new Response(
              `<html><head><meta property="og:video" content="https://cdn.example/v.mp4"><meta property="og:image" content="https://cdn.example/t.jpg"></head></html>`,
              { headers: { "content-type": "text/html" } }
            )
        )
      )
    );

    expect(asset?.videoUrl).toBe("https://cdn.example/v.mp4");
    expect(asset?.thumbnail).toBe("https://cdn.example/t.jpg");
  });

  test("rejects a missing link", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("gone", { status: 404 })))
    );

    expect(error._tag).toBe("GenericNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("reports a non-ok upstream status", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("busy", { status: 503 })))
    );

    expect(error._tag).toBe("GenericUpstream");
    expect(toThrownError(error).message).toBe(
      "This link returned 503. Try again later."
    );
  });

  test("rejects a non-page, non-video body", async () => {
    const error = await runVideosError(
      layersFor(
        stubFetch(
          () =>
            new Response('{"nope":true}', {
              headers: { "content-type": "application/json" },
            })
        )
      )
    );

    expect(error._tag).toBe("GenericNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found at this link. Only pages, video files, and GIFs are downloadable."
    );
  });

  test("rejects a page with no video", async () => {
    const error = await runVideosError(
      layersFor(
        stubFetch(
          () =>
            new Response("<html><head></head></html>", {
              headers: { "content-type": "text/html" },
            })
        )
      )
    );

    expect(error._tag).toBe("GenericNoVideo");
  });

  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "GenericUnreachable" as const }).message).toBe(
      "This link is unreachable right now. Try again later."
    );
    expect(toThrownError({ _tag: "GenericBadRedirect" as const }).message).toBe(
      "This link redirects somewhere invalid."
    );
    expect(
      toThrownError({ _tag: "GenericTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(
      toThrownError({ _tag: "GenericGuardBlocked" as const }).message
    ).toBe("Only public links are supported.");
    expect(toThrownError({ _tag: "GenericUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
