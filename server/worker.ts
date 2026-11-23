// Worker entry for Cloudflare. Same handlers as the Bun server, different
// transport facts: no node:dns (DoH lookup instead), no socket pinning (the
// edge dials the hostname after the guard approves it), secrets from the
// environment bindings. Static assets never reach here — the platform serves
// dist/ and only falls through to this Worker.

import { dohLookup } from "../app/lib/public-host";
import type { HostLookup } from "../app/lib/public-host";
import { handleDownload, handleResolve } from "./api";
import { overLimit } from "./rate-limit";
import type { RateLimiterBinding } from "./rate-limit";

export interface WorkerEnv {
  DOWNLOAD_SECRET?: string;
  RATE_LIMITER?: RateLimiterBinding;
}

export interface WorkerDeps {
  fetch?: typeof fetch;
  lookup?: HostLookup;
}

// Resolve costs an outbound fetch per call, so an open loop turns this Worker
// into a free proxy. The counter lives in rate-limit.ts (Cache API on Workers,
// module memory elsewhere).
const MAX_FORM_BYTES = 8 * 1024;

const tooManyRequests = (): Response =>
  Response.json(
    { error: "Too many requests. Try again in a minute." },
    { status: 429 }
  );

const tooLarge = (): Response =>
  Response.json({ error: "Request body too large." }, { status: 413 });

export const handleWorkerRequest = (
  request: Request,
  env: WorkerEnv,
  deps: WorkerDeps = {}
): Response | Promise<Response> => {
  const url = new URL(request.url);
  const doFetch = deps.fetch ?? fetch;

  // DoH carries the runtime fetch so tests can stub the transport once and
  // cover both the guard and the page in a single double.
  const lookup =
    deps.lookup ?? ((hostname: string) => dohLookup(hostname, doFetch));

  const secret = env.DOWNLOAD_SECRET;

  if (url.pathname === "/api/resolve" && request.method === "POST") {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) {
      return tooLarge();
    }

    const client =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for") ??
      "unknown";

    return overLimit(client, env.RATE_LIMITER).then((limited) =>
      limited
        ? tooManyRequests()
        : handleResolve(request, { fetch: doFetch, lookup, secret })
    );
  }

  if (url.pathname === "/api/download") {
    return handleDownload(request, { fetch: doFetch, lookup, secret });
  }

  return new Response("Not found", { status: 404 });
};

export default {
  fetch: (request: Request, env: WorkerEnv): Response | Promise<Response> =>
    handleWorkerRequest(request, env),
};
