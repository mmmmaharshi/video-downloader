import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveVimeoProgram, toThrownError } from "./vimeo-effect";

const VIMEO_URL = "https://vimeo.com/123456789";
const VIMEO_MP4 = "https://vod-progressive-ak.vimeo.com/v/12345.mp4";

const publicHost = () => ["93.184.216.34"];

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

describe("vimeo-effect", () => {
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
