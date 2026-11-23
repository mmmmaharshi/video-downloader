import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveRedditProgram, toThrownError } from "./reddit-effect";

const publicHost = () => ["93.184.216.34"];

const REDDIT_POST =
  "https://www.reddit.com/r/videos/comments/abc123/cool_video/";

const REDDIT_MP4 = "https://v.redd.it/xyz/DASH_1080.mp4?source=fallback";
const REDDIT_THUMB = "https://preview.redd.it/thumb.jpg";

interface RedditPostData {
  crosspost_parent_list?: RedditPostData[];
  hls_url?: string;
  id?: string;
  media?: { reddit_video?: { fallback_url?: string; hls_url?: string } };
  thumbnail?: string;
  title?: string;
}

const redditListing = (post: RedditPostData, status = 200) =>
  stubFetch(() =>
    Response.json([{ data: { children: [{ data: post }] } }], {
      headers: { "content-type": "application/json" },
      status,
    })
  );

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const runVideos = (
  layer: Layer.Layer<FetchDeps>,
  fetchUrl: string = REDDIT_POST,
  id = "abc123",
  sourceUrl: string = REDDIT_POST
) =>
  Effect.runPromise(
    Effect.provide(resolveRedditProgram({ fetchUrl, id, sourceUrl }), layer)
  );

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
  test("reads the fallback mp4 and thumbnail through layers", async () => {
    const [asset] = await runVideos(
      layersFor(
        redditListing({
          id: "abc123",
          media: { reddit_video: { fallback_url: REDDIT_MP4 } },
          thumbnail: REDDIT_THUMB,
          title: "cool",
        })
      )
    );

    expect(asset).toEqual({
      platform: "reddit",
      shortcode: "abc123",
      sourceUrl: REDDIT_POST,
      thumbnail: REDDIT_THUMB,
      title: "cool",
      videoUrl: REDDIT_MP4,
    });
  });

  test("unwraps crosspost_parent_list", async () => {
    const [asset] = await runVideos(
      layersFor(
        redditListing({
          crosspost_parent_list: [
            {
              id: "abc123",
              media: { reddit_video: { fallback_url: REDDIT_MP4 } },
              thumbnail: REDDIT_THUMB,
            },
          ],
          id: "abc123",
        })
      )
    );

    expect(asset?.videoUrl).toBe(REDDIT_MP4);
  });

  test("rejects a post with no video", async () => {
    const error = await runVideosError(
      layersFor(redditListing({ id: "abc123" }))
    );

    expect(error._tag).toBe("RedditNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found. Only public videos are downloadable."
    );
  });

  test("reports a non-json body", async () => {
    const error = await runVideosError(
      layersFor(
        stubFetch(() => new Response("<!DOCTYPE html>", { status: 200 }))
      )
    );

    expect(error._tag).toBe("RedditUnexpectedResponse");
    expect(toThrownError(error).message).toBe(
      "Reddit returned an unexpected response. Try again later."
    );
  });

  test("reports an error status", async () => {
    const error = await runVideosError(
      layersFor(stubFetch(() => new Response("busy", { status: 503 })))
    );

    expect(error._tag).toBe("RedditUpstream");
    expect(toThrownError(error).message).toBe(
      "Reddit returned 503. Try again later."
    );
  });

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
