// Worker entry for Cloudflare. Same handlers as the Bun server, different
// transport facts: no node:dns (DoH lookup instead), no socket pinning (the
// edge dials the hostname after the guard approves it), secrets from the
// environment bindings. Static assets never reach here — the platform serves
// dist/ and only falls through to this Worker.

import { dohLookup } from "../app/lib/public-host";
import type { HostLookup } from "../app/lib/public-host";
import { handleDownload, handleResolve } from "./api";

export interface WorkerEnv {
  DOWNLOAD_SECRET?: string;
}

export interface WorkerDeps {
  fetch?: typeof fetch;
  lookup?: HostLookup;
}

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
    return handleResolve(request, { fetch: doFetch, lookup, secret });
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
