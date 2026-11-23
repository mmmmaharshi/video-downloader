// Module: Transfer — deep module per CONTEXT.md
// Interface: proxy(videoUrl, stem, deps?) → Response
// Owns streaming + download naming. The caller proves the url came from the
// resolver (a signed href); the url itself is re-checked against the private
// network here, because the resolver can hand us an address it read out of a page.
// The flow runs as an Effect program (FetchDeps Layer) and is bridged back to
// promises here, so the route keeps its thrown-Response contract (ADR-0001).

import { Effect } from "effect";

import { fetchDepsLayer } from "./fetch-deps";
import type { HostLookup } from "./public-host";
import { toThrownResponse, transferProgram } from "./transfer-effect";

export interface TransferDeps {
  fetch?: typeof fetch;
  lookup?: HostLookup;
  maxMs?: number;
  /** the client's byte-range request, forwarded so video seeking works */
  range?: string | null;
  /** lower cap for tests; one download's worth by default */
  maxBytes?: number;
}

export const proxy = (
  videoUrl: string,
  stem: string,
  deps: TransferDeps = {}
): Promise<Response> => {
  const layer = fetchDepsLayer(deps.fetch, deps.lookup);

  return Effect.runPromise(
    Effect.mapError(
      Effect.provide(
        transferProgram({
          maxBytes: deps.maxBytes,
          maxMs: deps.maxMs,
          range: deps.range,
          stem,
          videoUrl,
        }),
        layer
      ),
      toThrownResponse
    )
  );
};
