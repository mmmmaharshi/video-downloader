import { Effect } from "effect";

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

// Module: ThreadsEffect — the Threads page scrape as an Effect program. The
// post page carries og:video; a page without one is not a video post.
// Dependencies arrive as a FetchDeps Layer; failures are a plain tagged union,
// mapped to the legacy user-facing strings at the bridge in media-resolver,
// which keeps resolve()'s thrown-Error contract.

export interface ThreadsNotFound {
  readonly _tag: "ThreadsNotFound";
}

export interface ThreadsUpstream {
  readonly _tag: "ThreadsUpstream";
  readonly status: number;
}

export interface ThreadsNoVideo {
  readonly _tag: "ThreadsNoVideo";
}

export interface ThreadsUnreachable {
  readonly _tag: "ThreadsUnreachable";
}

export interface ThreadsGuardBlocked {
  readonly _tag: "ThreadsGuardBlocked";
}

export interface ThreadsUnresolved {
  readonly _tag: "ThreadsUnresolved";
}

export interface ThreadsBadRedirect {
  readonly _tag: "ThreadsBadRedirect";
}

export interface ThreadsTooManyRedirects {
  readonly _tag: "ThreadsTooManyRedirects";
}

export type ThreadsError =
  | ThreadsBadRedirect
  | ThreadsGuardBlocked
  | ThreadsNoVideo
  | ThreadsNotFound
  | ThreadsTooManyRedirects
  | ThreadsUnreachable
  | ThreadsUnresolved
  | ThreadsUpstream;

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const threadsErrorMessage = (error: ThreadsError): string => {
  switch (error._tag) {
    case "ThreadsNotFound": {
      return "Post not found. Check the URL.";
    }

    case "ThreadsUpstream": {
      return `Threads returned ${error.status}. Try again later.`;
    }

    case "ThreadsNoVideo": {
      return "No video found. Only video posts are downloadable.";
    }

    case "ThreadsUnreachable": {
      return "Threads is unreachable right now. Try again later.";
    }

    case "ThreadsBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "ThreadsTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "ThreadsGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "ThreadsUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      const exhaustive: never = error;

      throw new Error(`Unhandled ThreadsError: ${JSON.stringify(exhaustive)}`);
    }
  }
};

export const toThrownError = (error: ThreadsError): Error =>
  new Error(threadsErrorMessage(error));

export interface ThreadsInput {
  readonly sourceUrl: string;
}

export interface ThreadsStreams {
  readonly thumbnail: string | undefined;
  readonly videoUrl: string;
}

export const resolveThreadsProgram = (
  input: ThreadsInput
): Effect.Effect<ThreadsStreams, ThreadsError, FetchDeps> =>
  Effect.gen(function* program() {
    const { sourceUrl } = input;
    const { doFetch, lookup } = yield* FetchDeps;

    const { res } = yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          badRedirect: { _tag: "ThreadsBadRedirect" as const },
          blocked: { _tag: "ThreadsGuardBlocked" as const },
          tooManyRedirects: { _tag: "ThreadsTooManyRedirects" as const },
          unreachable: { _tag: "ThreadsUnreachable" as const },
          unresolved: { _tag: "ThreadsUnresolved" as const },
        }),
      try: () =>
        fetchGuarded({ doFetch, lookup }, sourceUrl, {
          headers: { ...PAGE_HEADERS },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
    });

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "ThreadsNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "ThreadsUpstream" as const,
        status: res.status,
      });
    }

    const html = yield* Effect.tryPromise({
      catch: () => ({ _tag: "ThreadsUnreachable" as const }),
      try: () => readPageText(res),
    });

    const videoUrl = extractOgVideo(html);

    if (videoUrl === undefined) {
      return yield* Effect.fail({ _tag: "ThreadsNoVideo" as const });
    }

    return { thumbnail: extractThumbnail(html), videoUrl };
  });
