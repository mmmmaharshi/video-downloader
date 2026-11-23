import { Effect, Schema } from "effect";

import { readCappedUtf8 } from "./capped-body";
import { FetchDeps, classifyTransportError } from "./fetch-deps";
import {
  fetchGuarded,
  FETCH_TIMEOUT_MS,
  INVALID_REDIRECT_MESSAGE,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";
import { byQuality, renditionLabel } from "./renditions";
import type { Rendition } from "./renditions";
import type { VideoAsset } from "./resolve-query";
import { CHROME_UA } from "./user-agent";

// Module: DailymotionEffect — the Dailymotion metadata fetch as an Effect
// program. Qualities map to named rungs; each rung prefers its mp4 file and
// falls back to whatever the rung carries. Dependencies arrive as a FetchDeps
// Layer; failures are a plain tagged union, mapped to the legacy user-facing
// strings at the bridge in media-resolver, which keeps resolve()'s thrown-Error
// contract.

export interface DailymotionNotFound {
  readonly _tag: "DailymotionNotFound";
}

export interface DailymotionUpstream {
  readonly _tag: "DailymotionUpstream";
  readonly status: number;
}

export interface DailymotionUnexpectedResponse {
  readonly _tag: "DailymotionUnexpectedResponse";
}

export interface DailymotionNoVideo {
  readonly _tag: "DailymotionNoVideo";
}

export interface DailymotionUnreachable {
  readonly _tag: "DailymotionUnreachable";
}

export interface DailymotionGuardBlocked {
  readonly _tag: "DailymotionGuardBlocked";
}

export interface DailymotionBadRedirect {
  readonly _tag: "DailymotionBadRedirect";
}

export interface DailymotionTooManyRedirects {
  readonly _tag: "DailymotionTooManyRedirects";
}

export interface DailymotionUnresolved {
  readonly _tag: "DailymotionUnresolved";
}

export type DailymotionError =
  | DailymotionBadRedirect
  | DailymotionGuardBlocked
  | DailymotionNoVideo
  | DailymotionNotFound
  | DailymotionTooManyRedirects
  | DailymotionUnexpectedResponse
  | DailymotionUnreachable
  | DailymotionUnresolved
  | DailymotionUpstream;

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const dailymotionErrorMessage = (error: DailymotionError): string => {
  switch (error._tag) {
    case "DailymotionNotFound": {
      return "Post not found. Check the URL.";
    }

    case "DailymotionUpstream": {
      return `Dailymotion returned ${error.status}. Try again later.`;
    }

    case "DailymotionUnexpectedResponse": {
      return "Dailymotion returned an unexpected response. Try again later.";
    }

    case "DailymotionNoVideo": {
      return "No video found. Only public videos are downloadable.";
    }

    case "DailymotionUnreachable": {
      return "Dailymotion is unreachable right now. Try again later.";
    }

    case "DailymotionBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "DailymotionTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "DailymotionGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "DailymotionUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      const exhaustive: never = error;

      throw new Error(
        `Unhandled DailymotionError: ${JSON.stringify(exhaustive)}`
      );
    }
  }
};

export const toThrownError = (error: DailymotionError): Error =>
  new Error(dailymotionErrorMessage(error));

const DailymotionMetadata = Schema.Struct({
  poster_url: Schema.optional(Schema.String),
  qualities: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Array(
        Schema.Struct({
          type: Schema.optional(Schema.String),
          url: Schema.optional(Schema.String),
        })
      )
    )
  ),
  thumbnail_url: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
});

// Head-read budget shared with MediaResolver pages: an endpoint answer is
// small, a mislabelled binary is not. Kept local (not imported) so this
// program has no import edge into media-resolver, which owns the dispatch that
// calls back into it — an import there would be a cycle.
const DAILYMOTION_PAGE_BYTES = 512 * 1024;

const readText = async (res: Response): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, DAILYMOTION_PAGE_BYTES);

  return text;
};

const readJson = async <T>(
  res: Response,
  parse: (text: string) => T
): Promise<T> => {
  const text = await readText(res);

  return parse(text);
};

export interface DailymotionInput {
  readonly id: string;
  readonly sourceUrl: string;
}

export const resolveDailymotionProgram = (
  input: DailymotionInput
): Effect.Effect<VideoAsset[], DailymotionError, FetchDeps> =>
  Effect.gen(function* program() {
    const { id, sourceUrl } = input;
    const { doFetch, lookup } = yield* FetchDeps;

    const { res } = yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          badRedirect: { _tag: "DailymotionBadRedirect" as const },
          blocked: { _tag: "DailymotionGuardBlocked" as const },
          tooManyRedirects: { _tag: "DailymotionTooManyRedirects" as const },
          unreachable: { _tag: "DailymotionUnreachable" as const },
          unresolved: { _tag: "DailymotionUnresolved" as const },
        }),
      try: () =>
        fetchGuarded(
          { doFetch, lookup },
          `https://www.dailymotion.com/player/metadata/video/${id}`,
          {
            headers: {
              Accept: "application/json",
              "User-Agent": CHROME_UA,
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          }
        ),
    });

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "DailymotionNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "DailymotionUpstream" as const,
        status: res.status,
      });
    }

    const payload = yield* Effect.tryPromise({
      catch: () => ({ _tag: "DailymotionUnexpectedResponse" as const }),
      try: () => readJson(res, JSON.parse),
    });

    // a shape mismatch reads as absent (legacy unguarded access did the same):
    // a file the schema cannot see is a video we cannot download
    let data: typeof DailymotionMetadata.Type | undefined;

    try {
      data = Schema.decodeUnknownSync(DailymotionMetadata)(payload);
    } catch {
      data = undefined;
    }

    const qualities = data?.qualities ?? {};

    const renditions: Rendition[] = Object.entries(qualities).flatMap(
      ([key, entries]): Rendition[] => {
        const mp4 = entries?.find(
          (entry) =>
            entry.url !== undefined &&
            /mp4/iu.test(entry.type ?? entry.url ?? "")
        );

        const url =
          mp4?.url ?? entries?.find((entry) => entry.url !== undefined)?.url;

        if (url === undefined) {
          return [];
        }

        const height = Number(key);

        return Number.isNaN(height) ? [{ label: key, url }] : [{ height, url }];
      }
    );

    const assets = byQuality(renditions).map((rendition) => ({
      label: renditionLabel(rendition),
      platform: "dailymotion" as const,
      shortcode: id,
      sourceUrl,
      thumbnail: data?.poster_url ?? data?.thumbnail_url,
      title: data?.title,
      videoUrl: rendition.url,
    }));

    if (!assets.length) {
      return yield* Effect.fail({ _tag: "DailymotionNoVideo" as const });
    }

    return assets;
  });
