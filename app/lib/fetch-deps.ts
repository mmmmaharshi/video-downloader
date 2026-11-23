import { Context, Effect, Layer } from "effect";

import {
  INVALID_REDIRECT_MESSAGE,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import {
  areAddressesPublic,
  defaultLookup,
  GUARD_BLOCKED_MESSAGE,
  GUARD_UNRESOLVED_MESSAGE,
} from "./public-host";
import type { HostLookup } from "./public-host";

// Module: FetchDeps — the Effect seam for server-side fetching. Bun's fetch
// shape stays (pinned dialing needs it); the Workers port narrows this service
// instead of every call site.
export class FetchDeps extends Context.Service<
  FetchDeps,
  {
    readonly doFetch: typeof fetch;
    readonly lookup: HostLookup;
  }
>()("FetchDeps") {}

export const FetchDepsLive = Layer.succeed(FetchDeps)({
  doFetch: fetch,
  lookup: defaultLookup,
});

// One guard decision for every Effect program that dials a user-supplied url:
// resolve the host, refuse private ranges, and hand back the approved
// addresses. Callers name their own failures; a TTL-0 rebind between this
// check and the fetch stays open on Workers (see ADR-0003).
export const guardAddresses = <E>(
  url: string,
  lookup: HostLookup,
  errors: { readonly blocked: E; readonly unresolved: E }
): Effect.Effect<string[], E, FetchDeps> =>
  Effect.gen(function* guard() {
    let hostname: string;

    // callers pass matcher-validated or constructed URLs: an unparseable
    // hostname here is a programmer error, reported closed
    try {
      ({ hostname } = new URL(url));
    } catch {
      return yield* Effect.fail(errors.unresolved);
    }

    const addresses = yield* Effect.tryPromise({
      catch: () => errors.unresolved,
      // Promise.resolve wraps sync doubles too: a sync lookup throw must reject, not escape
      try: () => Promise.resolve(lookup(hostname)),
    });

    if (!areAddressesPublic(addresses)) {
      yield* Effect.fail(errors.blocked);
    }

    return addresses;
  });

// A guarded fetch throws the guard's plain Errors on a blocked hop, its own
// control-flow Errors on a bad redirect chain, and whatever the transport
// raised otherwise. Classify a failed fetch back into typed failures so
// programs keep legacy-exact messages without matching strings at every
// call site.
export const classifyTransportError = <E>(
  cause: unknown,
  errors: {
    readonly badRedirect: E;
    readonly blocked: E;
    readonly tooManyRedirects: E;
    readonly unreachable: E;
    readonly unresolved: E;
  }
): E => {
  if (cause instanceof Error) {
    if (cause.message === GUARD_BLOCKED_MESSAGE) {
      return errors.blocked;
    }

    if (cause.message === GUARD_UNRESOLVED_MESSAGE) {
      return errors.unresolved;
    }

    if (cause.message === INVALID_REDIRECT_MESSAGE) {
      return errors.badRedirect;
    }

    if (cause.message === TOO_MANY_REDIRECTS_MESSAGE) {
      return errors.tooManyRedirects;
    }
  }

  return errors.unreachable;
};
