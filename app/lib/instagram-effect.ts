import { Effect } from "effect";

import type { FetchDeps } from "./fetch-deps";
import {
  INVALID_REDIRECT_MESSAGE,
  PAGE_HEADERS,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import {
  extractEscapedVideo,
  extractOgVideo,
  extractThumbnail,
} from "./og-meta";
import { readPageText } from "./page-body";
import { fetchPage } from "./page-fetch";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";
import { unhandledError } from "./unhandled-error";
import { UA } from "./user-agent";

// Module: InstagramEffect — the Instagram page-plus-embed flow as an Effect
// program. The post page carries og:video; the embed page is a best-effort
// fallback for pages that do not. Dependencies arrive as a FetchDeps Layer;
// failures are a plain tagged union, mapped to the legacy user-facing strings
// at the bridge in media-resolver, which keeps resolve()'s thrown-Error
// contract.

export type InstagramError =
  | { readonly _tag: "InstagramBadRedirect" }
  | { readonly _tag: "InstagramGuardBlocked" }
  | { readonly _tag: "InstagramLoginRedirect" }
  | { readonly _tag: "InstagramLoginWall" }
  | { readonly _tag: "InstagramNoVideo" }
  | { readonly _tag: "InstagramNotFound" }
  | { readonly _tag: "InstagramTooManyRedirects" }
  | { readonly _tag: "InstagramUnreachable" }
  | { readonly _tag: "InstagramUnresolved" }
  | { readonly _tag: "InstagramUpstream"; readonly status: number };

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

    case "InstagramBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "InstagramTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "InstagramGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "InstagramUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      return unhandledError("Instagram", error);
    }
  }
};

export const toThrownError = (error: InstagramError): Error =>
  new Error(instagramErrorMessage(error));

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

    const { res, url } = yield* fetchPage(
      sourceUrl,
      { ...PAGE_HEADERS },
      {
        badRedirect: { _tag: "InstagramBadRedirect" as const },
        blocked: { _tag: "InstagramGuardBlocked" as const },
        tooManyRedirects: { _tag: "InstagramTooManyRedirects" as const },
        unreachable: { _tag: "InstagramUnreachable" as const },
        unresolved: { _tag: "InstagramUnresolved" as const },
      }
    );

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
      try: () => readPageText(res),
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

      // the embed page is a second scrape; a failure there means "no embed",
      // not a failed resolve, so the tag list is never reached
      const embedded = yield* fetchPage(
        endpoint,
        { "User-Agent": UA },
        {
          badRedirect: { _tag: "InstagramBadRedirect" as const },
          blocked: { _tag: "InstagramGuardBlocked" as const },
          tooManyRedirects: { _tag: "InstagramTooManyRedirects" as const },
          unreachable: { _tag: "InstagramUnreachable" as const },
          unresolved: { _tag: "InstagramUnresolved" as const },
        }
      ).pipe(
        Effect.flatMap(({ res: er }) =>
          Effect.promise(async () =>
            er.ok ? (extractEscapedVideo(await readPageText(er)) ?? null) : null
          )
        ),
        Effect.orElseSucceed(() => null)
      );

      videoUrl = embedded ?? videoUrl;
    }

    if (videoUrl === undefined) {
      return yield* Effect.fail({ _tag: "InstagramNoVideo" as const });
    }

    return { thumbnail: extractThumbnail(html), videoUrl };
  });
