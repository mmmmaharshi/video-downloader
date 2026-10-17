// Module: Transfer — deep module per CONTEXT.md
// Interface: proxy(videoUrl, stem, deps?) → Response
// Owns streaming + download naming. Access control lives upstream: the caller
// only passes urls the resolver produced (public hosts only), inside the
// remember window enforced at the download route.

import { UA } from "./user-agent";

const UPSTREAM_TIMEOUT_MS = 15_000;

// a 500MB file at modest speed finishes inside this; past it the upstream is stalled or abusive
const UPSTREAM_MAX_MS = 10 * 60_000;

export interface TransferDeps {
  fetch?: typeof fetch;
  maxMs?: number;
}

export const proxy = async (
  videoUrl: string | null,
  stem: string,
  deps: TransferDeps = {}
): Promise<Response> => {
  if (!videoUrl) {
    throw new Response("Missing url", { status: 400 });
  }

  const doFetch = deps.fetch ?? fetch;
  const maxMs = deps.maxMs ?? UPSTREAM_MAX_MS;

  // Fast-fail when headers stall; the overall bound accepts truncating a stalled stream.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;

  try {
    upstream = await doFetch(videoUrl, {
      headers: { "User-Agent": UA },
      // the overall bound outlives this block: a trickling upstream must not hold the connection forever
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(maxMs)]),
    });
  } catch {
    throw new Response("Upstream unreachable", { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok || !upstream.body) {
    throw new Response(`Upstream ${upstream.status}`, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "video/mp4";
  // derive the file extension from the upstream content-type (or the url) instead
  // of assuming mp4 — manifests (m3u8/mpd) and webm are downloadable too
  let ext = "mp4";

  if (contentType.includes("mpegurl") || /\.m3u8(?:[?#]|$)/iu.test(videoUrl)) {
    ext = "m3u8";
  } else if (
    contentType.includes("dash+xml") ||
    /\.mpd(?:[?#]|$)/iu.test(videoUrl)
  ) {
    ext = "mpd";
  } else if (
    contentType.includes("webm") ||
    /\.webm(?:[?#]|$)/iu.test(videoUrl)
  ) {
    ext = "webm";
  }

  // the stem arrives from the query string — keep it out of the header grammar
  const safeName = stem.replaceAll(/[^\w.-]+/gu, "_");

  const base = {
    "Cache-Control": "private, max-age=60",
    "Content-Disposition": `attachment; filename="${safeName}.${ext}"`,
    "Content-Type": contentType,
  };

  // lets the browser show progress; an absent upstream length stays absent
  const length = upstream.headers.get("content-length");

  const headers = length ? { ...base, "Content-Length": length } : base;

  return new Response(upstream.body, { headers });
};
