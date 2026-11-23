import { Effect } from "effect";

import { readCappedUtf8 } from "./capped-body";
import { FetchDeps, classifyTransportError } from "./fetch-deps";
import {
  fetchGuarded,
  FETCH_TIMEOUT_MS,
  INVALID_REDIRECT_MESSAGE,
  PAGE_HEADERS,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import { extractOgVideo, extractThumbnail } from "./og-meta";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";

// Module: LoomEffect — the Loom page scrape as an Effect program. The post
// page carries og:video; a page without one is not a video post. Dependencies
// arrive as a FetchDeps Layer; failures are a plain tagged union, mapped to
// the legacy user-facing strings at the bridge in media-resolver, which keeps
// resolve()'s thrown-Error contract.

export interface LoomNotFound {
  readonly _tag: "LoomNotFound";
}

export interface LoomUpstream {
  readonly _tag: "LoomUpstream";
  readonly status: number;
}

export interface LoomNoVideo {
  readonly _tag: "LoomNoVideo";
}

export interface LoomUnreachable {
  readonly _tag: "LoomUnreachable";
}

export interface LoomGuardBlocked {
  readonly _tag: "LoomGuardBlocked";
}

export interface LoomUnresolved {
  readonly _tag: "LoomUnresolved";
}

export interface LoomBadRedirect {
  readonly _tag: "LoomBadRedirect";
}

export interface LoomTooManyRedirects {
  readonly _tag: "LoomTooManyRedirects";
}

export type LoomError =
  | LoomBadRedirect
  | LoomGuardBlocked
  | LoomNoVideo
  | LoomNotFound
  | LoomTooManyRedirects
  | LoomUnreachable
  | LoomUnresolved
  | LoomUpstream;

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const loomErrorMessage = (error: LoomError): string => {
  switch (error._tag) {
    case "LoomNotFound": {
      return "Post not found. Check the URL.";
    }

    case "LoomUpstream": {
      return `Loom returned ${error.status}. Try again later.`;
    }

    case "LoomNoVideo": {
      return "No video found. Only public videos are downloadable.";
    }

    case "LoomUnreachable": {
      return "Loom is unreachable right now. Try again later.";
    }

    case "LoomBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "LoomTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "LoomGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "LoomUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      const exhaustive: never = error;

      throw new Error(`Unhandled LoomError: ${JSON.stringify(exhaustive)}`);
    }
  }
};

export const toThrownError = (error: LoomError): Error =>
  new Error(loomErrorMessage(error));

// Head-read budget shared with MediaResolver pages: a post page is small, a
// mislabelled binary is not. Kept local (not imported) so this program has no
// import edge into media-resolver, which owns the dispatch that calls back
// into it — an import there would be a cycle.
const LOOM_PAGE_BYTES = 512 * 1024;

const readText = async (res: Response): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, LOOM_PAGE_BYTES);

  return text;
};

export interface LoomInput {
  readonly sourceUrl: string;
}

export interface LoomStreams {
  readonly thumbnail: string | undefined;
  readonly videoUrl: string;
}

export const resolveLoomProgram = (
  input: LoomInput
): Effect.Effect<LoomStreams, LoomError, FetchDeps> =>
  Effect.gen(function* program() {
    const { sourceUrl } = input;
    const { doFetch, lookup } = yield* FetchDeps;

    const { res } = yield* Effect.tryPromise({
      catch: (cause) =>
        classifyTransportError(cause, {
          badRedirect: { _tag: "LoomBadRedirect" as const },
          blocked: { _tag: "LoomGuardBlocked" as const },
          tooManyRedirects: { _tag: "LoomTooManyRedirects" as const },
          unreachable: { _tag: "LoomUnreachable" as const },
          unresolved: { _tag: "LoomUnresolved" as const },
        }),
      try: () =>
        fetchGuarded({ doFetch, lookup }, sourceUrl, {
          headers: { ...PAGE_HEADERS },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
    });

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "LoomNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "LoomUpstream" as const,
        status: res.status,
      });
    }

    const html = yield* Effect.tryPromise({
      catch: () => ({ _tag: "LoomUnreachable" as const }),
      try: () => readText(res),
    });

    const videoUrl = extractOgVideo(html);

    if (videoUrl === undefined) {
      return yield* Effect.fail({ _tag: "LoomNoVideo" as const });
    }

    return { thumbnail: extractThumbnail(html), videoUrl };
  });
