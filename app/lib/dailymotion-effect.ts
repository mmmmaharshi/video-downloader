import { Effect } from "effect";
import { z } from "zod";

import { readCappedUtf8 } from "./capped-body";
import { FetchDeps, classifyTransportError } from "./fetch-deps";
import { fetchGuarded, FETCH_TIMEOUT_MS } from "./guarded-fetch";
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

export interface DailymotionUnresolved {
  readonly _tag: "DailymotionUnresolved";
}

export type DailymotionError =
  | DailymotionGuardBlocked
  | DailymotionNoVideo
  | DailymotionNotFound
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

const dailymotionMetadataSchema = z.object({
  poster_url: z.string().optional(),
  qualities: z
    .record(
      z.string(),
      z.array(
        z.object({
          type: z.string().optional(),
          url: z.string().optional(),
        })
      )
    )
    .optional(),
  thumbnail_url: z.string().optional(),
  title: z.string().optional(),
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
          blocked: { _tag: "DailymotionGuardBlocked" as const },
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

    const parsed = dailymotionMetadataSchema.safeParse(payload);

    if (!parsed.success) {
      return yield* Effect.fail({
        _tag: "DailymotionUnexpectedResponse" as const,
      });
    }

    const qualities = parsed.data.qualities ?? {};

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
      thumbnail: parsed.data.poster_url ?? parsed.data.thumbnail_url,
      title: parsed.data.title,
      videoUrl: rendition.url,
    }));

    if (!assets.length) {
      return yield* Effect.fail({ _tag: "DailymotionNoVideo" as const });
    }

    return assets;
  });
