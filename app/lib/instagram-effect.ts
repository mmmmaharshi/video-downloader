import { Effect } from "effect";

import { readCappedUtf8 } from "./capped-body";
import { FetchDeps, classifyTransportError } from "./fetch-deps";
import { fetchGuarded, FETCH_TIMEOUT_MS, PAGE_HEADERS } from "./guarded-fetch";
import { extractOgVideo, extractThumbnail, normalizeUrl } from "./og-meta";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";
import { UA } from "./user-agent";

// Module: InstagramEffect — the Instagram page-plus-embed flow as an Effect
// program. The post page carries og:video; the embed page is a best-effort
// fallback for pages that do not. Dependencies arrive as a FetchDeps Layer;
// failures are a plain tagged union, mapped to the legacy user-facing strings
// at the bridge in media-resolver, which keeps resolve()'s thrown-Error
// contract.

export interface InstagramNotFound {
  readonly _tag: "InstagramNotFound";
}

export interface InstagramUpstream {
  readonly _tag: "InstagramUpstream";
  readonly status: number;
}

export interface InstagramLoginRedirect {
  readonly _tag: "InstagramLoginRedirect";
}

export interface InstagramLoginWall {
  readonly _tag: "InstagramLoginWall";
}

export interface InstagramNoVideo {
  readonly _tag: "InstagramNoVideo";
}

export interface InstagramUnreachable {
  readonly _tag: "InstagramUnreachable";
}

export interface InstagramGuardBlocked {
  readonly _tag: "InstagramGuardBlocked";
}

export interface InstagramUnresolved {
  readonly _tag: "InstagramUnresolved";
}

export type InstagramError =
  | InstagramGuardBlocked
  | InstagramLoginRedirect
  | InstagramLoginWall
  | InstagramNotFound
  | InstagramNoVideo
  | InstagramUnreachable
  | InstagramUnresolved
  | InstagramUpstream;

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const instagramErrorMessage = (error: InstagramError): string => {
  switch (error._tag) {
    case "InstagramNotFound": {
      return "Post not found. Check the URL.";
    }

    case "InstagramUpstream": {
      return `Instagram returned ${error.status}. Try again later.`;
    }

    case "InstagramLoginRedirect": {
      return "Private or login-required post. Only public posts are supported.";
    }

    case "InstagramLoginWall": {
      return "Private post or requires login. Only public posts work.";
    }

    case "InstagramNoVideo": {
      return "No video found. Only video/reel posts are downloadable, or IG changed its page.";
    }

    case "InstagramUnreachable": {
      return "Instagram is unreachable right now. Try again later.";
    }

    case "InstagramGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "InstagramUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      const exhaustive: never = error;

      throw new Error(
        `Unhandled InstagramError: ${JSON.stringify(exhaustive)}`
      );
    }
  }
};

export const toThrownError = (error: InstagramError): Error =>
  new Error(instagramErrorMessage(error));

// Head-read budget shared with MediaResolver pages: a page carrying og:video
// is small, a mislabelled binary is not. Kept local (not imported) so this
// program has no import edge into media-resolver, which owns the dispatch that
// calls back into it — an import there would be a cycle.
const INSTAGRAM_PAGE_BYTES = 512 * 1024;

const readText = async (res: Response): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, INSTAGRAM_PAGE_BYTES);

  return text;
};

interface InstagramPage {
  readonly res: Response;
  readonly url: string;
}

const fetchPage = (
  url: string,
  headers: Record<string, string>
): Effect.Effect<InstagramPage, InstagramError, FetchDeps> =>
  Effect.gen(function* page() {
    const { doFetch, lookup } = yield* FetchDeps;

    return yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          blocked: { _tag: "InstagramGuardBlocked" as const },
          unreachable: { _tag: "InstagramUnreachable" as const },
          unresolved: { _tag: "InstagramUnresolved" as const },
        }),
      try: () =>
        fetchGuarded({ doFetch, lookup }, url, {
          headers,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
    });
  });

export interface InstagramInput {
  readonly shortcode: string;
  readonly sourceUrl: string;
}

export interface InstagramStreams {
  readonly thumbnail: string | undefined;
  readonly videoUrl: string;
}

export const resolveInstagramProgram = (
  input: InstagramInput
): Effect.Effect<InstagramStreams, InstagramError, FetchDeps> =>
  Effect.gen(function* program() {
    const { shortcode, sourceUrl } = input;
    const { doFetch, lookup } = yield* FetchDeps;

    const { res, url } = yield* fetchPage(sourceUrl, { ...PAGE_HEADERS });

    // more specific than the status itself: a login redirect is a private post, not a bad link
    if (
      (res.redirected && res.url.includes("/accounts/login")) ||
      url.includes("/accounts/login")
    ) {
      return yield* Effect.fail({ _tag: "InstagramLoginRedirect" as const });
    }

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "InstagramNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "InstagramUpstream" as const,
        status: res.status,
      });
    }

    const html = yield* Effect.tryPromise({
      catch: () => ({ _tag: "InstagramUnreachable" as const }),
      try: () => readText(res),
    });

    if (html.includes("/accounts/login") && !html.includes("og:video")) {
      return yield* Effect.fail({ _tag: "InstagramLoginWall" as const });
    }

    let videoUrl = extractOgVideo(html);

    // embed fallback — double-escaped JSON in embed HTML. Best effort: a
    // failed embed is reported as no video below.
    if (videoUrl === undefined) {
      let embedKind = "p";

      if (sourceUrl.includes("/reel")) {
        embedKind = "reel";
      } else if (sourceUrl.includes("/tv/")) {
        embedKind = "tv";
      }

      const endpoint = `https://www.instagram.com/${embedKind}/${shortcode}/embed/captioned/`;

      const embedded = yield* Effect.promise(() =>
        fetchGuarded({ doFetch, lookup }, endpoint, {
          headers: { "User-Agent": UA },
        }).then(
          async ({ res: er }) => {
            if (!er.ok) {
              return null;
            }

            const ehtml = await readText(er);

            const evRaw =
              ehtml.match(
                /(?:\\"|")video_url(?:\\"|")\s*:\s*(?:\\"|")(?<url>[^"]+)(?:\\"|")/u
              )?.groups?.url ??
              ehtml.match(
                /(?:\\"|")videoUrl(?:\\"|")\s*:\s*(?:\\"|")(?<url>[^"]+)(?:\\"|")/u
              )?.groups?.url;

            return evRaw === undefined
              ? null
              : normalizeUrl(evRaw).replaceAll("\\", "");
          },
          () => null
        )
      );

      videoUrl = embedded ?? videoUrl;
    }

    if (videoUrl === undefined) {
      return yield* Effect.fail({ _tag: "InstagramNoVideo" as const });
    }

    return { thumbnail: extractThumbnail(html), videoUrl };
  });
