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

describe("streamable-effect", () => {
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
