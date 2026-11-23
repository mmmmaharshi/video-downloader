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
import type { VideoAsset } from "./resolve-query";
import { CHROME_UA } from "./user-agent";

// Module: RedditEffect — the Reddit listing fetch as an Effect program. The
// .json endpoint exposes media.reddit_video.fallback_url plus a thumbnail;
// crossposts carry the media on crosspost_parent_list. Dependencies arrive as
// a FetchDeps Layer; failures are a plain tagged union, mapped to the legacy
// user-facing strings at the bridge in media-resolver, which keeps resolve()'s
// thrown-Error contract.

export interface RedditNotFound {
  readonly _tag: "RedditNotFound";
}

export interface RedditUpstream {
  readonly _tag: "RedditUpstream";
  readonly status: number;
}

export interface RedditUnexpectedResponse {
  readonly _tag: "RedditUnexpectedResponse";
}

export interface RedditNoVideo {
  readonly _tag: "RedditNoVideo";
}

export interface RedditUnreachable {
  readonly _tag: "RedditUnreachable";
}

export interface RedditGuardBlocked {
  readonly _tag: "RedditGuardBlocked";
}

export interface RedditBadRedirect {
  readonly _tag: "RedditBadRedirect";
}

export interface RedditTooManyRedirects {
  readonly _tag: "RedditTooManyRedirects";
}

export interface RedditUnresolved {
  readonly _tag: "RedditUnresolved";
}

export type RedditError =
  | RedditBadRedirect
  | RedditGuardBlocked
  | RedditNoVideo
  | RedditNotFound
  | RedditTooManyRedirects
  | RedditUnexpectedResponse
  | RedditUnreachable
  | RedditUnresolved
  | RedditUpstream;

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const redditErrorMessage = (error: RedditError): string => {
  switch (error._tag) {
    case "RedditNotFound": {
      return "Post not found. Check the URL.";
    }

    case "RedditUpstream": {
      return `Reddit returned ${error.status}. Try again later.`;
    }

    case "RedditUnexpectedResponse": {
      return "Reddit returned an unexpected response. Try again later.";
    }

    case "RedditNoVideo": {
      return "No video found. Only public videos are downloadable.";
    }

    case "RedditUnreachable": {
      return "Reddit is unreachable right now. Try again later.";
    }

    case "RedditBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "RedditTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "RedditGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "RedditUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      const exhaustive: never = error;

      throw new Error(`Unhandled RedditError: ${JSON.stringify(exhaustive)}`);
    }
  }
};

export const toThrownError = (error: RedditError): Error =>
  new Error(redditErrorMessage(error));

const redditListingSchema = z.array(
  z.object({
    data: z
      .object({
        children: z
          .array(
            z
              .object({
                data: z
                  .object({
                    crosspost_parent_list: z
                      .array(
                        z.object({
                          id: z.string().optional(),
                          media: z
                            .object({
                              reddit_video: z
                                .object({
                                  fallback_url: z.string().optional(),
                                  hls_url: z.string().optional(),
                                })
                                .optional(),
                            })
                            .optional(),
                          thumbnail: z.string().optional(),
                          title: z.string().optional(),
                        })
                      )
                      .optional(),
                    id: z.string().optional(),
                    media: z
                      .object({
                        reddit_video: z
                          .object({
                            fallback_url: z.string().optional(),
                            hls_url: z.string().optional(),
                          })
                          .optional(),
                      })
                      .optional(),
                    thumbnail: z.string().optional(),
                    title: z.string().optional(),
                  })
                  .optional(),
              })
              .optional()
          )
          .optional(),
      })
      .optional(),
  })
);

type RedditListing = z.infer<typeof redditListingSchema>;

interface RedditPost {
  readonly crosspost_parent_list?: readonly RedditPost[];
  readonly id?: string;
  readonly media?: {
    readonly reddit_video?: {
      readonly fallback_url?: string;
      readonly hls_url?: string;
    };
  };
  readonly thumbnail?: string;
  readonly title?: string;
}

interface RedditVideo {
  readonly thumbnail: string | undefined;
  readonly title: string | undefined;
  readonly videoUrl: string;
}

// Tolerant read: a shape mismatch reads as absent (legacy unguarded access
// did the same), reported as no video rather than a broken upstream.
const firstPost = (
  listing: RedditListing | undefined
): RedditPost | undefined => listing?.[0]?.data?.children?.[0]?.data;

const crossposted = (post: RedditPost | undefined): RedditPost | undefined =>
  post?.crosspost_parent_list?.[0] ?? post;

const pickVideoUrl = (data: RedditPost | undefined): string | undefined =>
  data?.media?.reddit_video?.fallback_url ?? data?.media?.reddit_video?.hls_url;

const pickThumbnail = (data: RedditPost | undefined): string | undefined => {
  if (data?.thumbnail !== undefined && data.thumbnail.startsWith("http")) {
    return data.thumbnail;
  }

  return undefined;
};

const pickRedditVideo = (
  listing: RedditListing | undefined
): RedditVideo | undefined => {
  const data = crossposted(firstPost(listing));
  const videoUrl = pickVideoUrl(data);

  if (videoUrl === undefined) {
    return undefined;
  }

  return { thumbnail: pickThumbnail(data), title: data?.title, videoUrl };
};

// Head-read budget shared with MediaResolver pages: an endpoint answer is
// small, a mislabelled binary is not. Kept local (not imported) so this
// program has no import edge into media-resolver, which owns the dispatch that
// calls back into it — an import there would be a cycle.
const REDDIT_PAGE_BYTES = 512 * 1024;

const readText = async (res: Response): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, REDDIT_PAGE_BYTES);

  return text;
};

const readJson = async <T>(
  res: Response,
  parse: (text: string) => T
): Promise<T> => {
  const text = await readText(res);

  return parse(text);
};

export interface RedditInput {
  readonly fetchUrl: string;
  readonly id: string;
  readonly sourceUrl: string;
}

const fetchRedditJson = (
  url: string
): Effect.Effect<unknown, RedditError, FetchDeps> =>
  Effect.gen(function* fetchJson() {
    const { doFetch, lookup } = yield* FetchDeps;

    const { res } = yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          badRedirect: { _tag: "RedditBadRedirect" as const },
          blocked: { _tag: "RedditGuardBlocked" as const },
          tooManyRedirects: { _tag: "RedditTooManyRedirects" as const },
          unreachable: { _tag: "RedditUnreachable" as const },
          unresolved: { _tag: "RedditUnresolved" as const },
        }),
      try: () =>
        fetchGuarded({ doFetch, lookup }, url, {
          headers: {
            Accept: "application/json",
            "User-Agent": CHROME_UA,
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
    });

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "RedditNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "RedditUpstream" as const,
        status: res.status,
      });
    }

    return yield* Effect.tryPromise({
      catch: () => ({ _tag: "RedditUnexpectedResponse" as const }),
      try: () => readJson(res, JSON.parse),
    });
  });

export const resolveRedditProgram = (
  input: RedditInput
): Effect.Effect<VideoAsset[], RedditError, FetchDeps> =>
  Effect.gen(function* program() {
    const { fetchUrl, id, sourceUrl } = input;

    const jsonUrl = fetchUrl.split("?")[0].replace(/\/+$/u, "");
    const withJson = `${jsonUrl}.json`;

    const payload = yield* fetchRedditJson(withJson);

    const parsed = redditListingSchema.safeParse(payload);

    const video = pickRedditVideo(parsed.success ? parsed.data : undefined);

    if (video === undefined) {
      return yield* Effect.fail({ _tag: "RedditNoVideo" as const });
    }

    return [
      {
        platform: "reddit" as const,
        shortcode: id,
        sourceUrl,
        thumbnail: video.thumbnail,
        title: video.title,
        videoUrl: video.videoUrl,
      },
    ];
  });
