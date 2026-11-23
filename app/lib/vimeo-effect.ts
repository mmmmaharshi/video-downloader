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
import { CHROME_UA } from "./user-agent";

// Module: VimeoEffect — the Vimeo player-config fetch as an Effect program.
// The config answers unauthenticated JSON with progressive MP4s; where no
// progressive file exists, the HLS manifest is kept as a manifest-only rung.
// Dependencies arrive as a FetchDeps Layer; failures are a plain tagged union,
// mapped to the legacy user-facing strings at the bridge in media-resolver,
// which keeps resolve()'s thrown-Error contract.

export type VimeoError =
  | { readonly _tag: "VimeoBadRedirect" }
  | { readonly _tag: "VimeoGuardBlocked" }
  | { readonly _tag: "VimeoNoVideo" }
  | { readonly _tag: "VimeoNotFound" }
  | { readonly _tag: "VimeoTooManyRedirects" }
  | { readonly _tag: "VimeoUnexpectedResponse" }
  | { readonly _tag: "VimeoUnreachable" }
  | { readonly _tag: "VimeoUnresolved" }
  | { readonly _tag: "VimeoUpstream"; readonly status: number };

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const vimeoErrorMessage = (error: VimeoError): string => {
  switch (error._tag) {
    case "VimeoNotFound": {
      return "Post not found. Check the URL.";
    }

    case "VimeoUpstream": {
      return `Vimeo returned ${error.status}. Try again later.`;
    }

    case "VimeoUnexpectedResponse": {
      return "Vimeo returned an unexpected response. Try again later.";
    }

    case "VimeoNoVideo": {
      return "No video found. Only public videos are downloadable.";
    }

    case "VimeoUnreachable": {
      return "Vimeo is unreachable right now. Try again later.";
    }

    case "VimeoBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "VimeoTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "VimeoGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "VimeoUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      return unhandledError("Vimeo", error);
    }
  }
};

export const toThrownError = (error: VimeoError): Error =>
  new Error(vimeoErrorMessage(error));

const VimeoProgressive = Schema.Struct({
  height: Schema.optional(Schema.Number),
  quality: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
});

const VimeoConfig = Schema.Struct({
  request: Schema.optional(
    Schema.Struct({
      files: Schema.optional(
        Schema.Struct({
          hls: Schema.optional(
            Schema.Struct({ url: Schema.optional(Schema.String) })
          ),
          progressive: Schema.optional(Schema.Array(VimeoProgressive)),
        })
      ),
    })
  ),
  video: Schema.optional(
    Schema.Struct({
      files: Schema.optional(
        Schema.Struct({
          progressive: Schema.optional(Schema.Array(VimeoProgressive)),
        })
      ),
      thumbnail_url: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
    })
  ),
});

export interface VimeoInput {
  readonly hash?: string;
  readonly id: string;
  readonly sourceUrl: string;
}

export const resolveVimeoProgram = (
  input: VimeoInput
): Effect.Effect<VideoAsset[], VimeoError, FetchDeps> =>
  Effect.gen(function* program() {
    const { hash, id, sourceUrl } = input;
    const config = new URL(`https://player.vimeo.com/video/${id}/config`);

    if (hash !== undefined) {
      config.searchParams.set("h", hash);
    }

    const { res } = yield* fetchPage(
      config.href,
      {
        Accept: "application/json",
        Referer: `https://player.vimeo.com/video/${id}`,
        "User-Agent": CHROME_UA,
      },
      {
        badRedirect: { _tag: "VimeoBadRedirect" as const },
        blocked: { _tag: "VimeoGuardBlocked" as const },
        tooManyRedirects: { _tag: "VimeoTooManyRedirects" as const },
        unreachable: { _tag: "VimeoUnreachable" as const },
        unresolved: { _tag: "VimeoUnresolved" as const },
      }
    );

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "VimeoNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "VimeoUpstream" as const,
        status: res.status,
      });
    }

    const payload = yield* Effect.tryPromise({
      catch: () => ({ _tag: "VimeoUnexpectedResponse" as const }),
      try: async () => JSON.parse(await readPageText(res)),
    });

    let decoded: typeof VimeoConfig.Type;

    try {
      decoded = Schema.decodeUnknownSync(VimeoConfig)(payload);
    } catch {
      return yield* Effect.fail({ _tag: "VimeoUnexpectedResponse" as const });
    }

    const progressive = (
      decoded.video?.files?.progressive ??
      decoded.request?.files?.progressive ??
      []
    ).filter(
      (
        entry
      ): entry is {
        height?: number;
        quality?: string;
        url: string;
        width?: number;
      } => entry.url !== undefined
    );

    const hls = decoded.request?.files?.hls?.url;

    const renditions: Rendition[] = progressive.map((entry) => ({
      height: entry.height,
      label: entry.quality,
      url: entry.url,
      width: entry.width,
    }));

    // Vimeo only ships HLS where no progressive file exists
    if (renditions.length === 0 && hls !== undefined) {
      renditions.push({ url: hls });
    }

    const assets = byQuality(renditions).map((rendition) => ({
      label: renditionLabel(rendition),
      platform: "vimeo" as const,
      shortcode: id,
      sourceUrl,
      thumbnail: decoded.video?.thumbnail_url,
      title: decoded.video?.title,
      videoUrl: rendition.url,
    }));

    if (!assets.length) {
      return yield* Effect.fail({ _tag: "VimeoNoVideo" as const });
    }

    return assets;
  });
