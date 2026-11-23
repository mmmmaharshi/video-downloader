import { Effect } from "effect";
import { z } from "zod";

import { readCappedUtf8 } from "./capped-body";
import { FetchDeps, classifyTransportError } from "./fetch-deps";
import { fetchGuarded, FETCH_TIMEOUT_MS, PAGE_HEADERS } from "./guarded-fetch";
import { extractOgVideo, extractThumbnail } from "./og-meta";
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

export interface TikTokUnresolved {
  readonly _tag: "TikTokUnresolved";
}

export type TikTokError =
  | TikTokGuardBlocked
  | TikTokNoVideo
  | TikTokNotFound
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

// Head-read budget shared with MediaResolver pages: a post page is small, a
// mislabelled binary is not. Kept local (not imported) so this program has no
// import edge into media-resolver, which owns the dispatch that calls back
// into it — an import there would be a cycle.
const TIKTOK_PAGE_BYTES = 512 * 1024;

const readText = async (res: Response): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, TIKTOK_PAGE_BYTES);

  return text;
};

const tiktokPayloadSchema = z.object({
  __DEFAULT_SCOPE__: z
    .object({
      "webapp.video-detail": z
        .object({
          itemInfo: z
            .object({
              itemStruct: z
                .object({
                  video: z
                    .object({
                      cover: z.string().optional(),
                      downloadAddr: z.string().optional(),
                      playAddr: z.string().optional(),
                    })
                    .optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
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
    const parsed = tiktokPayloadSchema.safeParse(JSON.parse(embedded));

    return parsed.success
      ? parsed.data.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo
          ?.itemStruct?.video
      : undefined;
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
          blocked: { _tag: "TikTokGuardBlocked" as const },
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
      try: () => readText(res),
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
