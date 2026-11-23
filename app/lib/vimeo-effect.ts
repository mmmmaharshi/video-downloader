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

// Module: VimeoEffect — the Vimeo player-config fetch as an Effect program.
// The config answers unauthenticated JSON with progressive MP4s; where no
// progressive file exists, the HLS manifest is kept as a manifest-only rung.
// Dependencies arrive as a FetchDeps Layer; failures are a plain tagged union,
// mapped to the legacy user-facing strings at the bridge in media-resolver,
// which keeps resolve()'s thrown-Error contract.

export interface VimeoNotFound {
  readonly _tag: "VimeoNotFound";
}

export interface VimeoUpstream {
  readonly _tag: "VimeoUpstream";
  readonly status: number;
}

export interface VimeoUnexpectedResponse {
  readonly _tag: "VimeoUnexpectedResponse";
}

export interface VimeoNoVideo {
  readonly _tag: "VimeoNoVideo";
}

export interface VimeoUnreachable {
  readonly _tag: "VimeoUnreachable";
}

export interface VimeoGuardBlocked {
  readonly _tag: "VimeoGuardBlocked";
}

export interface VimeoBadRedirect {
  readonly _tag: "VimeoBadRedirect";
}

export interface VimeoTooManyRedirects {
  readonly _tag: "VimeoTooManyRedirects";
}

export interface VimeoUnresolved {
  readonly _tag: "VimeoUnresolved";
}

export type VimeoError =
  | VimeoBadRedirect
  | VimeoGuardBlocked
  | VimeoNoVideo
  | VimeoNotFound
  | VimeoTooManyRedirects
  | VimeoUnexpectedResponse
  | VimeoUnreachable
  | VimeoUnresolved
  | VimeoUpstream;

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
      const exhaustive: never = error;

      throw new Error(`Unhandled VimeoError: ${JSON.stringify(exhaustive)}`);
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

// Head-read budget shared with MediaResolver pages: an endpoint answer is
// small, a mislabelled binary is not. Kept local (not imported) so this
// program has no import edge into media-resolver, which owns the dispatch that
// calls back into it — an import there would be a cycle.
const VIMEO_PAGE_BYTES = 512 * 1024;

const readText = async (res: Response): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, VIMEO_PAGE_BYTES);

  return text;
};

const readJson = async <T>(
  res: Response,
  parse: (text: string) => T
): Promise<T> => {
  const text = await readText(res);

  return parse(text);
};

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
    const { doFetch, lookup } = yield* FetchDeps;

    const config = new URL(`https://player.vimeo.com/video/${id}/config`);

    if (hash !== undefined) {
      config.searchParams.set("h", hash);
    }

    const { res } = yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          badRedirect: { _tag: "VimeoBadRedirect" as const },
          blocked: { _tag: "VimeoGuardBlocked" as const },
          tooManyRedirects: { _tag: "VimeoTooManyRedirects" as const },
          unreachable: { _tag: "VimeoUnreachable" as const },
          unresolved: { _tag: "VimeoUnresolved" as const },
        }),
      try: () =>
        fetchGuarded({ doFetch, lookup }, config.href, {
          headers: {
            Accept: "application/json",
            Referer: `https://player.vimeo.com/video/${id}`,
            "User-Agent": CHROME_UA,
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
    });

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
      try: () => readJson(res, JSON.parse),
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
