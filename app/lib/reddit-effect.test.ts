import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveRedditProgram, toThrownError } from "./reddit-effect";

const publicHost = () => ["93.184.216.34"];

const REDDIT_POST =
  "https://www.reddit.com/r/videos/comments/abc123/cool_video/";

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const runVideosError = (
  layer: Layer.Layer<FetchDeps>,
  fetchUrl: string = REDDIT_POST,
  id = "abc123",
  sourceUrl: string = REDDIT_POST
) =>
  Effect.runPromise(
    Effect.flip(
      Effect.provide(resolveRedditProgram({ fetchUrl, id, sourceUrl }), layer)
    )
  );

describe("reddit-effect", () => {
  test("reports a missing post", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("gone", { status: 404 })))
    );

    expect(error._tag).toBe("RedditNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "RedditUnreachable" as const }).message).toBe(
      "Reddit is unreachable right now. Try again later."
    );
    expect(toThrownError({ _tag: "RedditBadRedirect" as const }).message).toBe(
      "This link redirects somewhere invalid."
    );
    expect(
      toThrownError({ _tag: "RedditTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(toThrownError({ _tag: "RedditGuardBlocked" as const }).message).toBe(
      "Only public links are supported."
    );
    expect(toThrownError({ _tag: "RedditUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
