import { Effect, Schema } from "effect";

import { FetchDeps, classifyTransportError } from "./fetch-deps";
import {
  fetchGuarded,
  FETCH_TIMEOUT_MS,
  INVALID_REDIRECT_MESSAGE,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import { readPageText } from "./page-body";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";
import { preferMp4 } from "./renditions";
import type { VideoAsset } from "./resolve-query";
import { unhandledError } from "./unhandled-error";
import { CHROME_UA } from "./user-agent";

// Module: TwitterEffect — the X syndication flow as an Effect program. The
// token is the web client's derivation from the tweet id; an absent token
// returns an empty payload. An animated_gif is an mp4 on X too, carrying a
// single variant with bitrate 0. Dependencies arrive as a FetchDeps Layer;
// failures are a plain tagged union, mapped to the legacy user-facing strings
// at the bridge in media-resolver, which keeps resolve()'s thrown-Error
// contract.

export type TwitterError =
  | { readonly _tag: "TwitterBadRedirect" }
  | { readonly _tag: "TwitterGuardBlocked" }
  | { readonly _tag: "TwitterNoVideo" }
  | { readonly _tag: "TwitterNotFound" }
  | { readonly _tag: "TwitterTooManyRedirects" }
  | { readonly _tag: "TwitterUnexpectedResponse" }
  | { readonly _tag: "TwitterUnreachable" }
  | { readonly _tag: "TwitterUnresolved" }
  | { readonly _tag: "TwitterUpstream"; readonly status: number };

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const twitterErrorMessage = (error: TwitterError): string => {
  switch (error._tag) {
    case "TwitterNotFound": {
      return "Post not found. Check the URL.";
    }

    case "TwitterUpstream": {
      return `X returned ${error.status}. Try again later.`;
    }

    case "TwitterUnexpectedResponse": {
      return "X returned an unexpected response. Try again later.";
    }

    case "TwitterNoVideo": {
      return "No video found. Only video posts are downloadable.";
    }

    case "TwitterUnreachable": {
      return "X is unreachable right now. Try again later.";
    }

    case "TwitterBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "TwitterTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "TwitterGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "TwitterUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      return unhandledError("Twitter", error);
    }
  }
};

export const toThrownError = (error: TwitterError): Error =>
  new Error(twitterErrorMessage(error));

const Tweet = Schema.Struct({
  id_str: Schema.optional(Schema.String),
  mediaDetails: Schema.optional(
    Schema.Array(
      Schema.Struct({
        media_url_https: Schema.optional(Schema.String),
        type: Schema.optional(Schema.String),
        video_info: Schema.optional(
          Schema.Struct({
            variants: Schema.optional(
              Schema.Array(
                Schema.Struct({
                  bitrate: Schema.optional(Schema.Number),
                  content_type: Schema.String,
                  url: Schema.optional(Schema.String),
                })
              )
            ),
          })
        ),
      })
    )
  ),
});

export interface TwitterInput {
  readonly id: string;
  readonly sourceUrl: string;
}

export const resolveTwitterProgram = (
  input: TwitterInput
): Effect.Effect<VideoAsset[], TwitterError, FetchDeps> =>
  Effect.gen(function* program() {
    const { id, sourceUrl } = input;
    const { doFetch, lookup } = yield* FetchDeps;

    // the token is the web client's derivation from the tweet id; an absent token returns an empty payload
    // shortcut: X does not validate this token today and the derivation divides an id above 2^53 as a float — derive it exactly if X ever starts rejecting tokens
    const token = ((Number(id) / 1e15) * Math.PI)
      .toString(36)
      .replaceAll(/(?:0+|\.)/gu, "");

    const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`;

    const { res } = yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          badRedirect: { _tag: "TwitterBadRedirect" as const },
          blocked: { _tag: "TwitterGuardBlocked" as const },
          tooManyRedirects: { _tag: "TwitterTooManyRedirects" as const },
          unreachable: { _tag: "TwitterUnreachable" as const },
          unresolved: { _tag: "TwitterUnresolved" as const },
        }),
      try: () =>
        fetchGuarded({ doFetch, lookup }, endpoint, {
          headers: {
            Accept: "application/json",
            "User-Agent": CHROME_UA,
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
    });

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "TwitterNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "TwitterUpstream" as const,
        status: res.status,
      });
    }

    const payload = yield* Effect.tryPromise({
      catch: () => ({ _tag: "TwitterUnexpectedResponse" as const }),
      try: async () => JSON.parse(await readPageText(res)),
    });

    let tweet: typeof Tweet.Type;

    try {
      tweet = Schema.decodeUnknownSync(Tweet)(payload);
    } catch {
      return yield* Effect.fail({ _tag: "TwitterUnexpectedResponse" as const });
    }

    if (tweet.id_str === undefined) {
      return yield* Effect.fail({ _tag: "TwitterUnexpectedResponse" as const });
    }

    // an animated_gif is an mp4 on X too; it carries a single variant with bitrate 0
    const videos = (tweet.mediaDetails ?? []).filter(
      (m) => m.type === "video" || m.type === "animated_gif"
    );

    if (!videos.length) {
      return yield* Effect.fail({ _tag: "TwitterNoVideo" as const });
    }

    const assets: VideoAsset[] = [];

    for (const video of videos) {
      const variants = video.video_info?.variants ?? [];
      const mp4s = variants.filter((v) => v.content_type === "video/mp4");

      // eslint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy
      const sorted = [...preferMp4([...mp4s], [...variants])].sort(
        (a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0)
      );

      const [pick] = sorted;

      if (pick?.url) {
        assets.push({
          gif: video.type === "animated_gif" ? "video" : undefined,
          platform: "twitter" as const,
          shortcode: id,
          sourceUrl,
          thumbnail: video.media_url_https,
          videoUrl: pick.url,
        });
      }
    }

    if (!assets.length) {
      return yield* Effect.fail({ _tag: "TwitterNoVideo" as const });
    }

    return assets;
  });
