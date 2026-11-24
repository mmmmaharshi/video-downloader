import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { resolveDailymotionProgram, toThrownError } from "./dailymotion-effect";
import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";

const publicHost = () => ["93.184.216.34"];

const DM_URL = "https://www.dailymotion.com/video/x8abc123";

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
    readonly error?: { readonly title?: string };
    readonly poster_url?: string;
    readonly thumbnail_url?: string;
    readonly title?: string;
  }
) =>
  stubFetch(() =>
    Response.json(
      {
        error: extra?.error,
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
  test("reports the provider's own reason instead of a generic miss", async () => {
    const error = await runVideosError(
      layersFor(
        dmJson({}, { error: { title: "Video geo-restricted by the owner." } })
      )
    );

    expect(error._tag).toBe("DailymotionUnavailable");
    expect(toThrownError(error).message).toBe(
      "This video is unavailable: Video geo-restricted by the owner."
    );
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
