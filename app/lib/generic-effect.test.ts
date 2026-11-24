import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

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
