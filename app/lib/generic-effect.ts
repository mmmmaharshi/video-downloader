import { Effect } from "effect";

import { containerOf } from "./container";
import { FetchDeps, classifyTransportError } from "./fetch-deps";
import {
  fetchGuarded,
  FETCH_TIMEOUT_MS,
  INVALID_REDIRECT_MESSAGE,
  PAGE_HEADERS,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import { extractOgVideo, extractThumbnail } from "./og-meta";
import { readPageText } from "./page-body";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";
import type { VideoAsset } from "./resolve-query";
import { unhandledError } from "./unhandled-error";

// Module: GenericEffect — the catch-all fetch as an Effect program. A video
// or gif content-type resolves the link itself (the body is never read, only
// the headers); otherwise a page's og:video tag is the last resort. Any other
// file or API body is not downloadable. Dependencies arrive as a FetchDeps
// Layer; failures are a plain tagged union, mapped to the legacy user-facing
// strings at the bridge in media-resolver, which keeps resolve()'s thrown-Error
// contract.

export type GenericError =
  | { readonly _tag: "GenericBadRedirect" }
  | { readonly _tag: "GenericGuardBlocked" }
  | { readonly _tag: "GenericNoVideo" }
  | { readonly _tag: "GenericNotFound" }
  | { readonly _tag: "GenericTooManyRedirects" }
  | { readonly _tag: "GenericUnreachable" }
  | { readonly _tag: "GenericUnresolved" }
  | { readonly _tag: "GenericUpstream"; readonly status: number };

const NO_VIDEO_FOUND =
  "No video found at this link. Only pages, video files, and GIFs are downloadable.";

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const genericErrorMessage = (error: GenericError): string => {
  switch (error._tag) {
    case "GenericNotFound": {
      return "Post not found. Check the URL.";
    }

    case "GenericUpstream": {
      return `This link returned ${error.status}. Try again later.`;
    }

    case "GenericGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "GenericNoVideo": {
      return NO_VIDEO_FOUND;
    }

    case "GenericUnreachable": {
      return "This link is unreachable right now. Try again later.";
    }

    case "GenericBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "GenericTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "GenericUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      return unhandledError("This link", error);
    }
  }
};

export const toThrownError = (error: GenericError): Error =>
  new Error(genericErrorMessage(error));

const slugOf = (sourceUrl: string): string => {
  const segments = new URL(sourceUrl).pathname.split("/");
  let last = "";

  for (const segment of segments) {
    if (segment) {
      last = segment;
    }
  }

  let stem: string;

  try {
    stem = decodeURIComponent(last).replace(/\.[a-z0-9]+$/iu, "");
  } catch {
    stem = last.replace(/\.[a-z0-9]+$/iu, "");
  }

  return stem || "video";
};

const isPage = (contentType: string): boolean =>
  contentType === "" ||
  /^(?:text\/|application\/(?:xhtml\+xml|xml))/u.test(contentType);

export interface GenericInput {
  readonly sourceUrl: string;
}

export const resolveGenericProgram = (
  input: GenericInput
): Effect.Effect<VideoAsset[], GenericError, FetchDeps> =>
  Effect.gen(function* program() {
    const { sourceUrl } = input;
    const { doFetch, lookup } = yield* FetchDeps;

    const { res, url } = yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          badRedirect: { _tag: "GenericBadRedirect" as const },
          blocked: { _tag: "GenericGuardBlocked" as const },
          tooManyRedirects: { _tag: "GenericTooManyRedirects" as const },
          unreachable: { _tag: "GenericUnreachable" as const },
          unresolved: { _tag: "GenericUnresolved" as const },
        }),
      try: () =>
        fetchGuarded({ doFetch, lookup }, sourceUrl, {
          headers: { ...PAGE_HEADERS, Accept: "*/*" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
    });

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "GenericNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "GenericUpstream" as const,
        status: res.status,
      });
    }

    const shortcode = slugOf(url);
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

    if (
      contentType.startsWith("video/") ||
      contentType.startsWith("image/gif")
    ) {
      yield* Effect.promise(() => res.body?.cancel() ?? Promise.resolve());

      return [
        {
          gif: containerOf(url, contentType) === "gif" ? "file" : undefined,
          platform: "direct" as const,
          shortcode,
          sourceUrl,
          thumbnail: undefined,
          videoUrl: url,
        },
      ];
    }

    // only a page carries og:video; anything else is a file or an API body
    if (!isPage(contentType)) {
      return yield* Effect.fail({ _tag: "GenericNoVideo" as const });
    }

    const html = yield* Effect.tryPromise({
      catch: () => ({ _tag: "GenericUnreachable" as const }),
      try: () => readPageText(res),
    });

    const videoUrl = extractOgVideo(html);

    if (videoUrl === undefined) {
      return yield* Effect.fail({ _tag: "GenericNoVideo" as const });
    }

    return [
      {
        gif: undefined,
        platform: "direct" as const,
        shortcode,
        sourceUrl,
        thumbnail: extractThumbnail(html),
        videoUrl,
      },
    ];
  });
