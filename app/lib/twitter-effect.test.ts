import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveTwitterProgram, toThrownError } from "./twitter-effect";

const TWEET = "https://x.com/pressmanc/status/2006763209378922836";

const POSTER =
  "https://pbs.twimg.com/amplify_video_thumb/2006763055372227/img/N9cPDOrH7L72.jpg";

const BEST_MP4 =
  "https://video.twimg.com/amplify_video/2006763055372227/vid/avc1/1920x1080/9LGsQpvaGMJD8_Y.mp4";

const GIF_MP4 = "https://video.twimg.com/tweet_video/DOo8AEAIx2l.mp4";

const publicHost = () => ["93.184.216.34"];

const tweetResult = <T>(body: T, status = 200) =>
  stubFetch(() =>
    Response.json(body, {
      headers: { "content-type": "application/json" },
      status,
    })
  );

const videoMedia = {
  media_url_https: POSTER,
  type: "video",
  video_info: {
    variants: [
      {
        bitrate: 10_368_000,
        content_type: "video/mp4",
        url: BEST_MP4,
      },
      {
        bitrate: 832_000,
        content_type: "video/mp4",
        url: "https://video.twimg.com/vid/avc1/640x360/b.mp4",
      },
      {
        content_type: "application/x-mpegURL",
        url: "https://video.twimg.com/amplify_video/playlist.m3u8",
      },
    ],
  },
};

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const runVideos = (
  layer: Layer.Layer<FetchDeps>,
  id = "2006763209378922836",
  sourceUrl: string = TWEET
) =>
  Effect.runPromise(
    Effect.provide(resolveTwitterProgram({ id, sourceUrl }), layer)
  );

const runVideosError = (
  layer: Layer.Layer<FetchDeps>,
  id = "2006763209378922836",
  sourceUrl: string = TWEET
) =>
  Effect.runPromise(
    Effect.flip(Effect.provide(resolveTwitterProgram({ id, sourceUrl }), layer))
  );

describe("twitter-effect", () => {
  test("picks the highest-bitrate mp4 and the poster as thumbnail", async () => {
    const [asset] = await runVideos(
      layersFor(
        tweetResult({
          id_str: "2006763209378922836",
          mediaDetails: [videoMedia],
        })
      )
    );

    expect(asset).toEqual({
      gif: undefined,
      platform: "twitter",
      shortcode: "2006763209378922836",
      sourceUrl: TWEET,
      thumbnail: POSTER,
      videoUrl: BEST_MP4,
    });
  });

  test("marks animated gifs as gif video", async () => {
    const [asset] = await runVideos(
      layersFor(
        tweetResult({
          id_str: "1",
          mediaDetails: [
            {
              media_url_https: POSTER,
              type: "animated_gif",
              video_info: {
                variants: [{ content_type: "video/mp4", url: GIF_MP4 }],
              },
            },
          ],
        })
      )
    );

    expect(asset?.gif).toBe("video");
    expect(asset?.videoUrl).toBe(GIF_MP4);
  });

  test("reports a post with no video", async () => {
    const error = await runVideosError(
      layersFor(tweetResult({ id_str: "1", mediaDetails: [] }))
    );

    expect(error._tag).toBe("TwitterNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found. Only video posts are downloadable."
    );
  });

  test("reports an unexpected response without an id", async () => {
    const error = await runVideosError(layersFor(tweetResult({})));

    expect(error._tag).toBe("TwitterUnexpectedResponse");
    expect(toThrownError(error).message).toBe(
      "X returned an unexpected response. Try again later."
    );
  });

  test("reports an unreachable X instead of crashing", async () => {
    const down = stubFetch(() => {
      throw new TypeError("fetch failed");
    });

    const error = await runVideosError(layersFor(down));

    expect(error._tag).toBe("TwitterUnreachable");
    expect(toThrownError(error).message).toBe(
      "X is unreachable right now. Try again later."
    );
  });

  test("reports a missing post", async () => {
    const error = await runVideosError(
      layersFor(tweetResult({ error: "gone" }, 404))
    );

    expect(error._tag).toBe("TwitterNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("reports a down upstream with its status", async () => {
    const error = await runVideosError(
      layersFor(tweetResult({ error: "boom" }, 503))
    );

    expect(error._tag).toBe("TwitterUpstream");
    expect(toThrownError(error).message).toBe(
      "X returned 503. Try again later."
    );
  });

  test("refuses a private host with a typed guard failure", async () => {
    const privateLayer = Layer.succeed(FetchDeps)({
      doFetch: tweetResult({ id_str: "1", mediaDetails: [] }),
      lookup: () => ["127.0.0.1"],
    });

    const error = await runVideosError(privateLayer);

    expect(error._tag).toBe("TwitterGuardBlocked");
    expect(toThrownError(error).message).toBe(
      "Only public links are supported."
    );
  });

  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "TwitterBadRedirect" as const }).message).toBe(
      "This link redirects somewhere invalid."
    );
    expect(
      toThrownError({ _tag: "TwitterTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(
      toThrownError({ _tag: "TwitterGuardBlocked" as const }).message
    ).toBe("Only public links are supported.");
    expect(toThrownError({ _tag: "TwitterUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
