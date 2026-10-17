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

// An m3u8 points at its segments relatively, and a saved playlist has no base
// url left to resolve them against. Rewrite every reference absolute so the
// downloaded manifest still plays. `new URL` leaves absolute refs alone.
// shortcut: DASH (.mpd) is XML and is served untouched — no resolver emits one
// today; upgrade if a DASH source appears.
const absolutize = (ref: string, base: string): string => {
  try {
    return new URL(ref, base).href;
  } catch {
    return ref;
  }
};

const absolutizeManifest = (body: string, base: string): string =>
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
  // content-type casing varies in the wild (application/x-mpegURL), so compare lowercased
  const mime = contentType.toLowerCase();
  // derive the file extension from the upstream content-type (or the url) instead
  // of assuming mp4 — manifests (m3u8/mpd), webm and mov are downloadable too
  let ext = "mp4";

  if (mime.includes("mpegurl") || /\.m3u8(?:[?#]|$)/iu.test(videoUrl)) {
    ext = "m3u8";
  } else if (mime.includes("dash+xml") || /\.mpd(?:[?#]|$)/iu.test(videoUrl)) {
    ext = "mpd";
  } else if (mime.includes("webm") || /\.webm(?:[?#]|$)/iu.test(videoUrl)) {
    ext = "webm";
  } else if (mime.includes("quicktime") || /\.mov(?:[?#]|$)/iu.test(videoUrl)) {
    ext = "mov";
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

  if (ext === "m3u8") {
    // small text, so buffering costs nothing; the length below no longer applies
    return new Response(absolutizeManifest(await upstream.text(), videoUrl), {
      headers: base,
    });
  }

  const headers = length ? { ...base, "Content-Length": length } : base;

  return new Response(upstream.body, { headers });
};
