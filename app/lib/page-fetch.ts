// Module: PageFetch — the one guarded page request every scrape program makes.
// Each platform supplies only its own failure tags; the redirect, guard and
// timeout policy lives here so five programs cannot drift apart.

import { Effect } from "effect";

import { FetchDeps, classifyTransportError } from "./fetch-deps";
import { fetchGuarded, FETCH_TIMEOUT_MS } from "./guarded-fetch";

export interface PageFetchTags<E> {
  readonly badRedirect: E;
  readonly blocked: E;
  readonly tooManyRedirects: E;
  readonly unreachable: E;
  readonly unresolved: E;
}

export interface FetchedPage {
  readonly res: Response;
  readonly url: string;
}

export const fetchPage = <E>(
  url: string,
  headers: HeadersInit,
  tags: PageFetchTags<E>
): Effect.Effect<FetchedPage, E, FetchDeps> =>
  Effect.gen(function* page() {
    const { doFetch, lookup } = yield* FetchDeps;

    return yield* Effect.tryPromise({
      catch: (cause) => classifyTransportError(cause, tags),
      try: () =>
        fetchGuarded({ doFetch, lookup }, url, {
          headers,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
    });
  });
