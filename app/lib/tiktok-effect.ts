import { Effect, Schema } from "effect";

import { FetchDeps, classifyTransportError } from "./fetch-deps";
import {
  fetchGuarded,
  FETCH_TIMEOUT_MS,
  INVALID_REDIRECT_MESSAGE,
  PAGE_HEADERS,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import { extractOgVideo, extractThumbnail } from "./og-meta";
import { readPageText } from "./page-body";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";
import type { VideoAsset } from "./resolve-query";

// Module: TikTokEffect — the TikTok page scrape as an Effect program. The
// rehydration JSON carries playAddr/downloadAddr plus cover; og:video and
// og:image are the fallback when rehydration is missing, and a broken
// rehydration block reads as absent rather than an error. Dependencies arrive
// as a FetchDeps Layer; failures are a plain tagged union, mapped to the
// legacy user-facing strings at the bridge in media-resolver, which keeps
// resolve()'s thrown-Error contract.

export interface TikTokNotFound {
  readonly _tag: "TikTokNotFound";
}

export interface TikTokUpstream {
  readonly _tag: "TikTokUpstream";
  readonly status: number;
}

export interface TikTokNoVideo {
  readonly _tag: "TikTokNoVideo";
}

export interface TikTokUnreachable {
  readonly _tag: "TikTokUnreachable";
}

export interface TikTokGuardBlocked {
  readonly _tag: "TikTokGuardBlocked";
}

export interface TikTokBadRedirect {
  readonly _tag: "TikTokBadRedirect";
}

export interface TikTokTooManyRedirects {
  readonly _tag: "TikTokTooManyRedirects";
}

export interface TikTokUnresolved {
  readonly _tag: "TikTokUnresolved";
}

export type TikTokError =
  | TikTokBadRedirect
  | TikTokGuardBlocked
  | TikTokNoVideo
  | TikTokNotFound
  | TikTokTooManyRedirects
  | TikTokUnreachable
  | TikTokUnresolved
  | TikTokUpstream;

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const tiktokErrorMessage = (error: TikTokError): string => {
  switch (error._tag) {
    case "TikTokNotFound": {
      return "Post not found. Check the URL.";
    }

    case "TikTokUpstream": {
      return `TikTok returned ${error.status}. Try again later.`;
    }

    case "TikTokNoVideo": {
      return "No video found. Only public videos are downloadable, and TikTok limits anonymous access.";
    }

    case "TikTokUnreachable": {
      return "TikTok is unreachable right now. Try again later.";
    }

    case "TikTokBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "TikTokTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "TikTokGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "TikTokUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      const exhaustive: never = error;

      throw new Error(`Unhandled TikTokError: ${JSON.stringify(exhaustive)}`);
    }
  }
};

export const toThrownError = (error: TikTokError): Error =>
  new Error(tiktokErrorMessage(error));

const TikTokPayload = Schema.Struct({
  __DEFAULT_SCOPE__: Schema.optional(
    Schema.Struct({
      "webapp.video-detail": Schema.optional(
        Schema.Struct({
          itemInfo: Schema.optional(
            Schema.Struct({
              itemStruct: Schema.optional(
                Schema.Struct({
                  video: Schema.optional(
                    Schema.Struct({
                      cover: Schema.optional(Schema.String),
                      downloadAddr: Schema.optional(Schema.String),
                      playAddr: Schema.optional(Schema.String),
                    })
                  ),
                })
              ),
            })
          ),
        })
      ),
    })
  ),
});

// tolerant by design: a missing block or a shape mismatch reads as absent
// (legacy swallowed parse failures too), falling through to og:video
interface TikTokVideo {
  readonly cover?: string;
  readonly downloadAddr?: string;
  readonly playAddr?: string;
}

const extractTikTokVideo = (html: string): TikTokVideo | undefined => {
  const embedded = html.match(
    /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(?<json>.*)<\/script>/su
  )?.groups?.json;

  if (embedded === undefined) {
    return undefined;
  }

  try {
    const decoded = Schema.decodeUnknownSync(TikTokPayload)(
      JSON.parse(embedded)
    );

    return decoded.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo
      ?.itemStruct?.video;
  } catch {
    return undefined;
  }
};

export interface TikTokInput {
  readonly id: string;
  readonly sourceUrl: string;
}

export const resolveTikTokProgram = (
  input: TikTokInput
): Effect.Effect<VideoAsset[], TikTokError, FetchDeps> =>
  Effect.gen(function* program() {
    const { id, sourceUrl } = input;
    const { doFetch, lookup } = yield* FetchDeps;

    const { res } = yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          badRedirect: { _tag: "TikTokBadRedirect" as const },
          blocked: { _tag: "TikTokGuardBlocked" as const },
          tooManyRedirects: { _tag: "TikTokTooManyRedirects" as const },
          unreachable: { _tag: "TikTokUnreachable" as const },
          unresolved: { _tag: "TikTokUnresolved" as const },
        }),
      try: () =>
        fetchGuarded({ doFetch, lookup }, sourceUrl, {
          headers: { ...PAGE_HEADERS },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
    });

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "TikTokNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "TikTokUpstream" as const,
        status: res.status,
      });
    }

    const html = yield* Effect.tryPromise({
      catch: () => ({ _tag: "TikTokUnreachable" as const }),
      try: () => readPageText(res),
    });

    // tolerant by design: a missing block or a shape mismatch reads as
    // absent (legacy swallowed parse failures too), falling through to og:video
    const video = extractTikTokVideo(html);

    let videoUrl = video?.playAddr ?? video?.downloadAddr;
    let thumbnail = video?.cover;

    videoUrl ??= extractOgVideo(html);
    thumbnail ??= extractThumbnail(html);

    if (videoUrl === undefined) {
      return yield* Effect.fail({ _tag: "TikTokNoVideo" as const });
    }

    return [
      {
        platform: "tiktok" as const,
        shortcode: id,
        sourceUrl,
        thumbnail,
        videoUrl,
      },
    ];
  });
