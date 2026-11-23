import { Effect, Schema } from "effect";

import type { FetchDeps } from "./fetch-deps";
import {
  INVALID_REDIRECT_MESSAGE,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import { readPageText } from "./page-body";
import { fetchPage } from "./page-fetch";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";
import { byQuality, renditionLabel } from "./renditions";
import type { Rendition } from "./renditions";
import type { VideoAsset } from "./resolve-query";
import { unhandledError } from "./unhandled-error";
import { JSON_HEADERS } from "./user-agent";

// Module: DailymotionEffect — the Dailymotion metadata fetch as an Effect
// program. Qualities map to named rungs; each rung prefers its mp4 file and
// falls back to whatever the rung carries. Dependencies arrive as a FetchDeps
// Layer; failures are a plain tagged union, mapped to the legacy user-facing
// strings at the bridge in media-resolver, which keeps resolve()'s thrown-Error
// contract.

export type DailymotionError =
  | { readonly _tag: "DailymotionBadRedirect" }
  | { readonly _tag: "DailymotionGuardBlocked" }
  | { readonly _tag: "DailymotionNoVideo" }
  | { readonly _tag: "DailymotionNotFound" }
  | { readonly _tag: "DailymotionTooManyRedirects" }
  | { readonly _tag: "DailymotionUnavailable"; readonly reason: string }
  | { readonly _tag: "DailymotionUnexpectedResponse" }
  | { readonly _tag: "DailymotionUnreachable" }
  | { readonly _tag: "DailymotionUnresolved" }
  | { readonly _tag: "DailymotionUpstream"; readonly status: number };

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

    case "DailymotionUnavailable": {
      // the provider's title usually ends with its own period
      return `This video is unavailable: ${error.reason.replace(/\.+$/u, "")}.`;
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
      return unhandledError("Dailymotion", error);
    }
  }
};

export const toThrownError = (error: DailymotionError): Error =>
  new Error(dailymotionErrorMessage(error));

const DailymotionMetadata = Schema.Struct({
  // the provider states why it refuses (geo-restriction, takedown) rather than
  // omitting qualities silently
  error: Schema.optional(
    Schema.Struct({ title: Schema.optional(Schema.String) })
  ),
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

export interface DailymotionInput {
  readonly id: string;
  readonly sourceUrl: string;
}

export const resolveDailymotionProgram = (
  input: DailymotionInput
): Effect.Effect<VideoAsset[], DailymotionError, FetchDeps> =>
  Effect.gen(function* program() {
    const { id, sourceUrl } = input;

    const { res } = yield* fetchPage(
      `https://www.dailymotion.com/player/metadata/video/${id}`,
      JSON_HEADERS,
      {
        badRedirect: { _tag: "DailymotionBadRedirect" as const },
        blocked: { _tag: "DailymotionGuardBlocked" as const },
        tooManyRedirects: { _tag: "DailymotionTooManyRedirects" as const },
        unreachable: { _tag: "DailymotionUnreachable" as const },
        unresolved: { _tag: "DailymotionUnresolved" as const },
      }
    );

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
      try: async () => JSON.parse(await readPageText(res)),
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
      const reason = data?.error?.title;

      // the provider's own words beat a generic miss: a geo-blocked video is
      // not "only public videos are downloadable"
      if (reason !== undefined) {
        return yield* Effect.fail({
          _tag: "DailymotionUnavailable" as const,
          reason,
        });
      }

      return yield* Effect.fail({ _tag: "DailymotionNoVideo" as const });
    }

    return assets;
  });
