import { Effect } from "effect";
import { z } from "zod";

import { readCappedUtf8 } from "./capped-body";
import { FetchDeps, guardAddresses } from "./fetch-deps";
import { fetchGuarded, PAGE_HEADERS } from "./guarded-fetch";
import type { GuardedFetch } from "./guarded-fetch";
import { pinnedFetch } from "./pinned-fetch";
import type { HostLookup } from "./public-host";

// Module: RumbleEffect — the Rumble fetch flow as an Effect program. Rumble
// answers the first anonymous visit with a 307 to itself plus an RNSC cookie;
// fetch has no cookie jar, so the watch loop carries it by hand. Dependencies
// arrive as a FetchDeps Layer (the same pair the promise seam injects);
// failures are a plain tagged union, mapped to the legacy user-facing strings
// at the bridge in media-resolver, which keeps resolve()'s thrown-Error
// contract. Plain interfaces (not error classes): the repo allows one class
// per file, and these tags only cross one bridge.

export interface RumbleNotFound {
  readonly _tag: "RumbleNotFound";
}

export interface RumbleNoVideo {
  readonly _tag: "RumbleNoVideo";
}

export interface RumbleUpstream {
  readonly _tag: "RumbleUpstream";
  readonly status: number;
}

export interface RumbleUnexpectedResponse {
  readonly _tag: "RumbleUnexpectedResponse";
}

export interface RumbleGuardBlocked {
  readonly _tag: "RumbleGuardBlocked";
}

export interface RumbleUnresolved {
  readonly _tag: "RumbleUnresolved";
}

export interface RumbleTooManyRedirects {
  readonly _tag: "RumbleTooManyRedirects";
}

export interface RumbleBadRedirect {
  readonly _tag: "RumbleBadRedirect";
}

export type RumbleError =
  | RumbleBadRedirect
  | RumbleGuardBlocked
  | RumbleNoVideo
  | RumbleNotFound
  | RumbleTooManyRedirects
  | RumbleUnexpectedResponse
  | RumbleUnresolved
  | RumbleUpstream;

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const rumbleErrorMessage = (error: RumbleError): string => {
  switch (error._tag) {
    case "RumbleNotFound": {
      return "Post not found. Check the URL.";
    }

    case "RumbleNoVideo": {
      return "No downloadable video found for this post.";
    }

    case "RumbleUpstream": {
      return `Rumble returned ${error.status}. Try again later.`;
    }

    case "RumbleUnexpectedResponse": {
      return "Rumble returned an unexpected response. Try again later.";
    }

    case "RumbleGuardBlocked": {
      return "Only public links are supported.";
    }

    case "RumbleUnresolved": {
      return "Could not resolve this link. Check the URL.";
    }

    case "RumbleTooManyRedirects": {
      return "This link redirects too many times.";
    }

    case "RumbleBadRedirect": {
      return "This link redirects somewhere invalid.";
    }

    default: {
      const exhaustive: never = error;

      throw new Error(`Unhandled RumbleError: ${JSON.stringify(exhaustive)}`);
    }
  }
};

// Head-read budget shared with MediaResolver pages: a page carrying its data
// is small, a mislabelled binary is not. Kept local (not imported) so this
// program has no import edge into media-resolver, which owns the dispatch that
// calls back into it — an import there would be a cycle.
const RUMBLE_PAGE_BYTES = 512 * 1024;

const readText = async (res: Response): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, RUMBLE_PAGE_BYTES);

  return text;
};

const rumbleGuard = (
  url: string,
  lookup: HostLookup
): Effect.Effect<string[], RumbleError, FetchDeps> =>
  guardAddresses(url, lookup, {
    blocked: { _tag: "RumbleGuardBlocked" as const },
    unresolved: { _tag: "RumbleUnresolved" as const },
  });

interface WatchHop {
  readonly cookie: string | undefined;
  readonly location: string | undefined;
  readonly res: Response;
}

const fetchWatchHop = (
  url: string,
  cookie: string | undefined
): Effect.Effect<WatchHop, RumbleError, FetchDeps> =>
  Effect.gen(function* hop() {
    const { doFetch, lookup } = yield* FetchDeps;

    const addresses = yield* rumbleGuard(url, lookup);

    const headers = new Headers(PAGE_HEADERS);

    if (cookie !== undefined) {
      headers.set("Cookie", cookie);
    }

    const res = yield* Effect.tryPromise({
      catch: () => ({ _tag: "RumbleUnexpectedResponse" as const }),
      try: () =>
        pinnedFetch(doFetch, url, addresses, {
          headers,
          redirect: "manual",
        }),
    });

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "RumbleNotFound" as const });
    }

    const location =
      res.status >= 300 && res.status < 400
        ? (res.headers.get("location") ?? undefined)
        : undefined;

    if (location === undefined) {
      return { cookie, location, res };
    }

    const [rnsc] = (res.headers.get("set-cookie") ?? "").split(";");

    let nextCookie = cookie;

    if (rnsc !== undefined && rnsc.startsWith("RNSC=")) {
      nextCookie = cookie === undefined ? rnsc : `${cookie}; ${rnsc}`;
    }

    yield* Effect.tryPromise({
      catch: () => ({ _tag: "RumbleUnexpectedResponse" as const }),
      try: () => res.body?.cancel() ?? Promise.resolve(),
    });

    return { cookie: nextCookie, location, res };
  });

interface WatchPage {
  readonly cookie: string | undefined;
  readonly html: string;
}

const fetchWatchPage = (
  url: string
): Effect.Effect<WatchPage, RumbleError, FetchDeps> =>
  Effect.gen(function* watch() {
    let current = url;
    let cookie: string | undefined;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const {
        cookie: hopCookie,
        location,
        res,
      } = yield* fetchWatchHop(current, cookie);

      cookie = hopCookie;

      if (location === undefined) {
        if (!res.ok) {
          return yield* Effect.fail({
            _tag: "RumbleUpstream" as const,
            status: res.status,
          });
        }

        const html = yield* Effect.tryPromise({
          catch: () => ({ _tag: "RumbleUnexpectedResponse" as const }),
          try: () => readText(res),
        });

        return { cookie, html };
      }

      try {
        current = new URL(location, current).href;
      } catch {
        return yield* Effect.fail({ _tag: "RumbleBadRedirect" as const });
      }
    }

    return yield* Effect.fail({ _tag: "RumbleTooManyRedirects" as const });
  });

// unauthenticated JSON behind the embed player: direct MP4s with meta heights
const embedJsSchema = z.object({
  ua: z
    .object({
      mp4: z
        .array(
          z.object({
            meta: z
              .object({ h: z.number(), w: z.number() })
              .partial()
              .optional(),
            url: z.string(),
          })
        )
        .optional(),
    })
    .optional(),
});

export interface RumbleMp4 {
  readonly meta?: { readonly h?: number; readonly w?: number };
  readonly url: string;
}

const fetchEmbedMp4s = (
  embedId: string,
  cookie?: string
): Effect.Effect<readonly RumbleMp4[], RumbleError, FetchDeps> =>
  Effect.gen(function* embed() {
    const { doFetch, lookup } = yield* FetchDeps;

    const endpoint = `https://rumble.com/embedJS/u3/${embedId}?request=video&ver=2&v=${embedId}`;

    yield* rumbleGuard(endpoint, lookup);

    const headers = new Headers({
      ...PAGE_HEADERS,
      Accept: "application/json",
    });

    if (cookie !== undefined) {
      headers.set("Cookie", cookie);
    }

    const http: GuardedFetch = { doFetch, lookup };

    const { res } = yield* Effect.tryPromise({
      catch: () => ({ _tag: "RumbleUnexpectedResponse" as const }),
      try: () => fetchGuarded(http, endpoint, { headers }),
    });

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "RumbleNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "RumbleUpstream" as const,
        status: res.status,
      });
    }

    const payload = yield* Effect.tryPromise({
      catch: () => ({ _tag: "RumbleUnexpectedResponse" as const }),
      // eslint-disable-next-line require-await -- async keeps the JSON parse inside the rejection boundary
      try: async () => JSON.parse(await readText(res)),
    });

    const parsed = embedJsSchema.safeParse(payload);

    if (!parsed.success) {
      return yield* Effect.fail({ _tag: "RumbleUnexpectedResponse" as const });
    }

    return parsed.data.ua?.mp4 ?? [];
  });

export interface RumbleInput {
  readonly direct: boolean;
  readonly id: string;
  readonly sourceUrl: string;
}

export interface RumbleStreams {
  readonly html: string | undefined;
  readonly mp4s: readonly RumbleMp4[];
}

export const resolveRumbleProgram = (
  input: RumbleInput
): Effect.Effect<RumbleStreams, RumbleError, FetchDeps> =>
  Effect.gen(function* program() {
    const { direct, id, sourceUrl } = input;

    let embedId = id;
    let html: string | undefined;

    if (!direct) {
      const { cookie, html: page } = yield* fetchWatchPage(sourceUrl);

      const found = page.match(/rumble\.com\/embed\/(?<embedId>v[A-Za-z0-9]+)/u)
        ?.groups?.embedId;

      if (found === undefined) {
        return yield* Effect.fail({ _tag: "RumbleNoVideo" as const });
      }

      embedId = found;
      html = page;

      const watchMp4s = yield* fetchEmbedMp4s(embedId, cookie);

      if (!watchMp4s.length) {
        return yield* Effect.fail({ _tag: "RumbleNoVideo" as const });
      }

      return { html, mp4s: watchMp4s };
    }

    const mp4s = yield* fetchEmbedMp4s(embedId);

    if (!mp4s.length) {
      return yield* Effect.fail({ _tag: "RumbleNoVideo" as const });
    }

    return { html, mp4s };
  });
