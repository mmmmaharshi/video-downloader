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
import { unhandledError } from "./unhandled-error";

// Module: LoomEffect — the Loom page scrape as an Effect program. The post
// page carries og:video; a page without one is not a video post. Dependencies
// arrive as a FetchDeps Layer; failures are a plain tagged union, mapped to
// the legacy user-facing strings at the bridge in media-resolver, which keeps
// resolve()'s thrown-Error contract.

export type LoomError =
  | { readonly _tag: "LoomBadRedirect" }
  | { readonly _tag: "LoomGuardBlocked" }
  | { readonly _tag: "LoomNoVideo" }
  | { readonly _tag: "LoomNotFound" }
  | { readonly _tag: "LoomTooManyRedirects" }
  | { readonly _tag: "LoomUnreachable" }
  | { readonly _tag: "LoomUnresolved" }
  | { readonly _tag: "LoomUpstream"; readonly status: number };

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
      return unhandledError("Loom", error);
    }
  }
};

export const toThrownError = (error: LoomError): Error =>
  new Error(loomErrorMessage(error));

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
      try: () => readPageText(res),
    });

    const videoUrl = extractOgVideo(html);

    if (videoUrl === undefined) {
      return yield* Effect.fail({ _tag: "LoomNoVideo" as const });
    }

    return { thumbnail: extractThumbnail(html), videoUrl };
  });
