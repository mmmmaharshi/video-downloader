import { Effect } from "effect";
import { z } from "zod";

import { readCappedUtf8 } from "./capped-body";
import { FetchDeps, classifyTransportError } from "./fetch-deps";
import {
  fetchGuarded,
  FETCH_TIMEOUT_MS,
  INVALID_REDIRECT_MESSAGE,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";
import { preferMp4, byQuality, renditionLabel } from "./renditions";
import type { VideoAsset } from "./resolve-query";
import { CHROME_UA } from "./user-agent";

// Module: StreamableEffect — the Streamable API fetch as an Effect program.
// The metadata endpoint answers JSON with per-quality files; mp4 is preferred
// within a rung but a manifest-only rung is kept. Dependencies arrive as a
// FetchDeps Layer; failures are a plain tagged union, mapped to the legacy
// user-facing strings at the bridge in media-resolver, which keeps resolve()'s
// thrown-Error contract.

export interface StreamableNotFound {
  readonly _tag: "StreamableNotFound";
}

export interface StreamableUpstream {
  readonly _tag: "StreamableUpstream";
  readonly status: number;
}

export interface StreamableUnexpectedResponse {
  readonly _tag: "StreamableUnexpectedResponse";
}

export interface StreamableNoVideo {
  readonly _tag: "StreamableNoVideo";
}

export interface StreamableUnreachable {
  readonly _tag: "StreamableUnreachable";
}

export interface StreamableGuardBlocked {
  readonly _tag: "StreamableGuardBlocked";
}

export interface StreamableBadRedirect {
  readonly _tag: "StreamableBadRedirect";
}

export interface StreamableTooManyRedirects {
  readonly _tag: "StreamableTooManyRedirects";
}

export interface StreamableUnresolved {
  readonly _tag: "StreamableUnresolved";
}

export type StreamableError =
  | StreamableBadRedirect
  | StreamableGuardBlocked
  | StreamableNoVideo
  | StreamableNotFound
  | StreamableTooManyRedirects
  | StreamableUnexpectedResponse
  | StreamableUnreachable
  | StreamableUnresolved
  | StreamableUpstream;

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const streamableErrorMessage = (error: StreamableError): string => {
  switch (error._tag) {
    case "StreamableNotFound": {
      return "Post not found. Check the URL.";
    }

    case "StreamableUpstream": {
      return `Streamable returned ${error.status}. Try again later.`;
    }

    case "StreamableUnexpectedResponse": {
      return "Streamable returned an unexpected response. Try again later.";
    }

    case "StreamableNoVideo": {
      return "No video found. Only video posts are downloadable.";
    }

    case "StreamableUnreachable": {
      return "Streamable is unreachable right now. Try again later.";
    }

    case "StreamableBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "StreamableTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "StreamableGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "StreamableUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      const exhaustive: never = error;

      throw new Error(
        `Unhandled StreamableError: ${JSON.stringify(exhaustive)}`
      );
    }
  }
};

export const toThrownError = (error: StreamableError): Error =>
  new Error(streamableErrorMessage(error));

const streamableResponseSchema = z.object({
  files: z
    .record(
      z.string(),
      z.object({
        height: z.number().optional(),
        url: z.string().optional(),
        width: z.number().optional(),
      })
    )
    .optional(),
  thumbnail_url: z.string().optional(),
  title: z.string().optional(),
});

// Head-read budget shared with MediaResolver pages: an endpoint answer is
// small, a mislabelled binary is not. Kept local (not imported) so this
// program has no import edge into media-resolver, which owns the dispatch that
// calls back into it — an import there would be a cycle.
const STREAMABLE_PAGE_BYTES = 512 * 1024;

const readText = async (res: Response): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, STREAMABLE_PAGE_BYTES);

  return text;
};

const readJson = async <T>(
  res: Response,
  parse: (text: string) => T
): Promise<T> => {
  const text = await readText(res);

  return parse(text);
};

export interface StreamableInput {
  readonly code: string;
  readonly sourceUrl: string;
}

export const resolveStreamableProgram = (
  input: StreamableInput
): Effect.Effect<VideoAsset[], StreamableError, FetchDeps> =>
  Effect.gen(function* program() {
    const { code, sourceUrl } = input;
    const { doFetch, lookup } = yield* FetchDeps;

    const endpoint = `https://api.streamable.com/videos/${code}`;

    const { res } = yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          badRedirect: { _tag: "StreamableBadRedirect" as const },
          blocked: { _tag: "StreamableGuardBlocked" as const },
          tooManyRedirects: { _tag: "StreamableTooManyRedirects" as const },
          unreachable: { _tag: "StreamableUnreachable" as const },
          unresolved: { _tag: "StreamableUnresolved" as const },
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
      return yield* Effect.fail({ _tag: "StreamableNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "StreamableUpstream" as const,
        status: res.status,
      });
    }

    const payload = yield* Effect.tryPromise({
      catch: () => ({ _tag: "StreamableUnexpectedResponse" as const }),
      try: () => readJson(res, JSON.parse),
    });

    const parsed = streamableResponseSchema.safeParse(payload);

    // a shape mismatch reads as empty, the way the untyped read did: a video
    // list with no playable file is a missing video, not a broken upstream
    const data = parsed.success ? parsed.data : {};

    const files = Object.values(data.files ?? {}).filter(
      (f): f is { height?: number; url: string; width?: number } =>
        f.url !== undefined
    );

    const mp4s = files.filter((f) => /mp4/iu.test(f.url));

    const assets = byQuality(preferMp4(mp4s, files)).map((f) => ({
      label: renditionLabel(f),
      platform: "streamable" as const,
      shortcode: code,
      sourceUrl,
      thumbnail: data.thumbnail_url,
      title: data.title,
      // Streamable serves the url with a doubled scheme ("https:https://..."); collapse it
      videoUrl: f.url.replace(/^https?:https:\/\//u, "https://"),
    }));

    if (!assets.length) {
      return yield* Effect.fail({ _tag: "StreamableNoVideo" as const });
    }

    return assets;
  });
