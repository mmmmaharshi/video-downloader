// Module: Api — the HTTP boundary for resolve and download. Pure functions of
// the Web Request/Response shape, so any runtime (Bun.serve, Vite dev, a Worker
// fetch handler) can serve them with no framework between the route and the
// domain. Thrown Responses (bad signature, proxy failures) are returned, never
// thrown, so the host never needs error-response conventions.

import { fromDownloadRequest, toDownloadHref } from "../app/lib/download-link";
import { resolve } from "../app/lib/media-resolver";
import type { HostLookup } from "../app/lib/public-host";
import type { ResolveResult } from "../app/lib/resolve-query";
import { proxy } from "../app/lib/transfer";

export interface ApiDeps {
  fetch?: typeof fetch;
  lookup?: HostLookup;
  now?: number;
  secret?: string;
}

export const handleResolve = async (
  request: Request,
  deps: ApiDeps = {}
): Promise<Response> => {
  try {
    const formData = await request.formData();
    const url = String(formData.get("url") ?? "").trim();

    const assets = await resolve(url, {
      fetch: deps.fetch,
      lookup: deps.lookup,
    });

    // signed here, where the secret lives: the client only follows the href
    const resolved = assets.map((asset, index) => ({
      ...asset,
      downloadHref: toDownloadHref(assets, index, {
        now: deps.now,
        secret: deps.secret,
      }),
    }));

    return Response.json({ assets: resolved } satisfies ResolveResult);
  } catch (error) {
    // a bad paste, a blocked host, or an unreadable body is a message for the
    // user; only a non-message failure is a bug worth a stack
    const msg =
      error instanceof Error ? error.message : "Failed to extract video";

    if (error instanceof Error) {
      console.warn(`resolve failed: ${msg}`);
    } else {
      console.error(error);
    }

    return Response.json({ error: msg } satisfies ResolveResult);
  }
};

export const handleDownload = async (
  request: Request,
  deps: ApiDeps = {}
): Promise<Response> => {
  try {
    // a bad, altered or expired signature rejects with a 403 Response here
    const { videoUrl, stem } = fromDownloadRequest(request.url, {
      now: deps.now,
      secret: deps.secret,
    });

    return await proxy(videoUrl, stem, {
      fetch: deps.fetch,
      lookup: deps.lookup,
      range: request.headers.get("range"),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error(error);

    return new Response("Failed to download", { status: 500 });
  }
};
