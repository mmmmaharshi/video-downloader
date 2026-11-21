// Module: Transfer — deep module per CONTEXT.md
// Interface: proxy(videoUrl, stem, deps?) → Response
// Owns streaming + download naming. The caller proves the url came from the
// resolver (a signed href); the url itself is re-checked against the private
// network here, because the resolver can hand us an address it read out of a page.

import { containerOf, isManifestContainer } from "./container";
import type { Container } from "./container";
import type { HostLookup } from "./public-host";
import { assertPublicHost, defaultLookup } from "./public-host";
import { UA } from "./user-agent";

const UPSTREAM_TIMEOUT_MS = 15_000;

// stays inside the function's own wall clock; the platform still cuts a stream that overruns it
const UPSTREAM_MAX_MS = 4 * 60_000;

// one download through the function, not a bulk mirror
const MAX_DOWNLOAD_BYTES = 1024 ** 3;

export interface TransferDeps {
  fetch?: typeof fetch;
  lookup?: HostLookup;
  maxMs?: number;
  /** the client's byte-range request, forwarded so video seeking works */
  range?: string | null;
}

// A manifest points at its media relatively, and a saved playlist has no base
// url left to resolve them against, so the downloaded file would not play.
// Rewrite every reference absolute. `new URL` leaves absolute refs alone.
// `catch` keeps a reference that is not a url at all verbatim: the player fails
// that one file, rather than us failing the whole download.
const absolutize = (ref: string, base: string): string => {
  try {
    return new URL(ref, base).href;
  } catch {
    return ref;
  }
};

const absolutizeM3u8 = (body: string, base: string): string =>
  body
    .split("\n")
    .map((line) => {
      if (line.trim() === "") {
        return line;
      }

      // tags carry their own refs in URI="…" attributes (key, init map, renditions)
      const tagged = line.replaceAll(
        /URI="(?<ref>[^"]+)"/gu,
        (_match, ref: string) => `URI="${absolutize(ref, base)}"`
      );

      return tagged.startsWith("#") ? tagged : absolutize(tagged.trim(), base);
    })
    .join("\n");

// The DASH refs are BaseURL elements and the attributes that name media
// (byte ranges — indexRange, mediaRange — are numbers, not urls, so they are
// left alone). Median templates like `$Number$` survive `new URL` verbatim.
const absolutizeMpd = (body: string, base: string): string =>
  body
    .replaceAll(
      /<BaseURL>(?<ref>[^<]+)<\/BaseURL>/gu,
      (_match, ref: string) =>
        `<BaseURL>${absolutize(ref.trim(), base)}</BaseURL>`
    )
    .replaceAll(
      /(?<attr>\b(?:initialization|media|sourceURL|xlink:href)=")(?<ref>[^"]+)"/gu,
      (_match, attr: string, ref: string) => `${attr}${absolutize(ref, base)}"`
    );

const absolutizeManifest = (
  body: string,
  base: string,
  container: Container
): string =>
  container === "mpd" ? absolutizeMpd(body, base) : absolutizeM3u8(body, base);

export const proxy = async (
  videoUrl: string,
  stem: string,
  deps: TransferDeps = {}
): Promise<Response> => {
  // a page can name an internal host as its video; the proxy must not fetch it
  try {
    await assertPublicHost(videoUrl, deps.lookup ?? defaultLookup);
  } catch {
    throw new Response("Only public links are supported", { status: 403 });
  }

  const doFetch = deps.fetch ?? fetch;
  const maxMs = deps.maxMs ?? UPSTREAM_MAX_MS;

  // Fast-fail when headers stall; the overall bound accepts truncating a stalled stream.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;

  const upstreamHeaders = new Headers({ "User-Agent": UA });

  // a seeking video asks for byte ranges; the upstream answers 206 and the
  // proxy passes that answer through instead of rebuffering the whole file
  if (deps.range) {
    upstreamHeaders.set("Range", deps.range);
  }

  try {
    upstream = await doFetch(videoUrl, {
      headers: upstreamHeaders,
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

  // the container decides the download's extension: one rule, shared with the
  // preview, so the two can never disagree about what this file is
  const ext = containerOf(videoUrl, contentType);

  // the stem arrives from the query string — keep it out of the header grammar
  const safeName = stem.replaceAll(/[^\w.-]+/gu, "_");

  const base = {
    "Cache-Control": "private, max-age=60",
    "Content-Disposition": `attachment; filename="${safeName}.${ext}"`,
    "Content-Type": contentType,
  };

  const length = upstream.headers.get("content-length");

  if (length && Number(length) > MAX_DOWNLOAD_BYTES) {
    await upstream.body.cancel();

    throw new Response("This file is too large to download here", {
      status: 413,
    });
  }

  // a 206 is a byte slice, not a file: stream it through untouched, naming
  // nothing and rewriting nothing
  if (upstream.status === 206) {
    const rangeHeaders = new Headers({
      "Cache-Control": "private, max-age=60",
      "Content-Type": contentType,
    });

    for (const name of ["Accept-Ranges", "Content-Length", "Content-Range"]) {
      const value = upstream.headers.get(name);

      if (value) {
        rangeHeaders.set(name, value);
      }
    }

    return new Response(upstream.body, { headers: rangeHeaders, status: 206 });
  }

  if (isManifestContainer(ext)) {
    // small text, so buffering costs nothing; the length below no longer applies
    return new Response(
      absolutizeManifest(await upstream.text(), videoUrl, ext),
      { headers: base }
    );
  }

  const headers = length ? { ...base, "Content-Length": length } : base;

  // seeking works when the client knows ranges are served
  return new Response(upstream.body, {
    headers: { ...headers, "Accept-Ranges": "bytes" },
  });
};
