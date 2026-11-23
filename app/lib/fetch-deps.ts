import { Context, Layer } from "effect";

import { defaultLookup } from "./public-host";
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
