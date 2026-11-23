// Module: MediaResolver — deep module per CONTEXT.md
// Interface: resolve(sourceUrl, deps?) → VideoAsset[]
// A post can hold several videos (X lists them all in mediaDetails); Instagram's page
// exposes at most one, so IG resolves to a one-element list.
// Seam: fetch (live in prod, in-memory fixtures in tests — two adapters = real seam)

import { Effect, Layer } from "effect";

import { containerOf } from "./container";
import {
  resolveDailymotionProgram,
  toThrownError as toDailymotionThrownError,
} from "./dailymotion-effect";
import {
  resolveFacebookProgram,
  toThrownError as toFacebookThrownError,
} from "./facebook-effect";
import { FetchDeps } from "./fetch-deps";
import {
  resolveGenericProgram,
  toThrownError as toGenericThrownError,
} from "./generic-effect";
import { resolveInstagramProgram, toThrownError } from "./instagram-effect";
import {
  resolveLoomProgram,
  toThrownError as toLoomThrownError,
} from "./loom-effect";
import { EMPTY_LINK } from "./messages";
import { extractThumbnail } from "./og-meta";
import { hostMatches, isPlatformHost } from "./platforms";
import { defaultLookup } from "./public-host";
import type { HostLookup } from "./public-host";
import {
  resolveRedditProgram,
  toThrownError as toRedditThrownError,
} from "./reddit-effect";
import { byQuality, renditionLabel } from "./renditions";
import type { VideoAsset } from "./resolve-query";
import { resolveRumbleProgram, rumbleErrorMessage } from "./rumble-effect";
import {
  resolveStreamableProgram,
  toThrownError as toStreamableThrownError,
} from "./streamable-effect";
import {
  resolveThreadsProgram,
  toThrownError as toThreadsThrownError,
} from "./threads-effect";
import {
  resolveTikTokProgram,
  toThrownError as toTikTokThrownError,
} from "./tiktok-effect";
import {
  resolveTwitterProgram,
  toThrownError as toTwitterThrownError,
} from "./twitter-effect";
import {
  resolveVimeoProgram,
  toThrownError as toVimeoThrownError,
} from "./vimeo-effect";
import { getYouTubeFormats } from "./youtube";
import type { TubeAsset, YouTubeDeps } from "./youtube";

export interface MediaResolverDeps {
  fetch?: typeof fetch;
  youtube?: (
    id: string,
    deps?: YouTubeDeps
  ) => Promise<TubeAsset[]> | TubeAsset[];
  lookup?: HostLookup;
}

// One guarded transport for every network read in this module: the lookup
// proves the host, PinnedFetch makes the socket use that proof.
interface FetchContext {
  doFetch: typeof fetch;
  lookup: HostLookup;
}

// Path shapes only: the host comes from the one list in Platforms.
const INSTA_PATH_RE = /^\/(?:p|reels?|tv)\/(?<shortcode>[A-Za-z0-9_-]+)\/?$/u;

const TWEET_PATH_RE = /^\/(?:[^/?#]+\/)*status(?:es)?\/(?<id>\d+)(?:[/?#]|$)/iu;

const instagramShortcode = (url: string): string | undefined => {
  const parsed = URL.parse(url);

  if (!parsed || !hostMatches("instagram", parsed.hostname.toLowerCase())) {
    return undefined;
  }

  return parsed.pathname.match(INSTA_PATH_RE)?.groups?.shortcode;
};

const tweetId = (url: string): string | undefined => {
  const parsed = URL.parse(url);

  if (!parsed || !hostMatches("twitter", parsed.hostname.toLowerCase())) {
    return undefined;
  }

  return parsed.pathname.match(TWEET_PATH_RE)?.groups?.id;
};

// a supported host with an unrecognized path is a mistyped platform link,
// not a generic page — fail fast instead of fetching it
const isKnownMediaHost = (sourceUrl: string): boolean =>
  isPlatformHost(new URL(sourceUrl).hostname.toLowerCase());

// Instagram answers the plural /reels/ route with a login redirect for anonymous
// fetches while /reel/ serves the same post: fetch the canonical singular form.
const canonicalReelUrl = (url: string): string =>
  url.replace("instagram.com/reels/", "instagram.com/reel/");

// A watch page is identified by its 11-char id, wherever it sits: watch?v= (any param
// order), youtu.be, /shorts/, /live/, /embed/. A regex cannot read query params, so parse.
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/u;

const matchYouTubeId = (sourceUrl: string): string | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (host === "youtu.be") {
    const [id] = url.pathname.slice(1).split("/");

    return id && YT_ID_RE.test(id) ? id : undefined;
  }

  if (hostMatches("youtube", host)) {
    const v = url.searchParams.get("v");

    if (v && YT_ID_RE.test(v)) {
      return v;
    }

    const pathId = url.pathname.match(
      /^\/(?:shorts|live|embed)\/(?<pathId>[A-Za-z0-9_-]{11})(?:\/|$)/u
    )?.groups?.pathId;

    if (pathId) {
      return pathId;
    }
  }

  return undefined;
};

// The Instagram flow runs as an Effect program (FetchDeps Layer) and is bridged
// back to promises here, so resolve() keeps its thrown-Error contract.
const resolveInstagram = async (
  sourceUrl: string,
  shortcode: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  const streams = await Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveInstagramProgram({ shortcode, sourceUrl }), layer),
      toThrownError
    )
  );

  return [
    {
      platform: "instagram" as const,
      shortcode,
      sourceUrl,
      thumbnail: streams.thumbnail,
      videoUrl: streams.videoUrl,
    },
  ];
};

// Facebook ships the video file only on the full (browser-header) page variant:
// browser_native_hd/sd_url inside the ScheduledServerJS payload, with og:video
// and hd_src/sd_src as fallbacks. Supported shapes: /reel/<id>, /watch/?v=<id>,
// /<page>/videos/<id>, and the fb.watch short link.
const matchFacebookId = (
  sourceUrl: string
): { id: string; fetchUrl: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (host === "fb.watch") {
    const [code] = url.pathname.slice(1).split("/");

    return code ? { fetchUrl: sourceUrl, id: code } : undefined;
  }

  if (hostMatches("facebook", host)) {
    const reel = url.pathname.match(/^\/reel\/(?<id>\d+)(?:\/|$)/u)?.groups?.id;

    if (reel) {
      return { fetchUrl: `https://www.facebook.com/reel/${reel}/`, id: reel };
    }

    const v = url.searchParams.get("v");

    if (v && /^\d+$/u.test(v)) {
      return { fetchUrl: `https://www.facebook.com/watch/?v=${v}`, id: v };
    }

    const video = url.pathname.match(/\/videos\/(?<id>\d+)(?:\/|$)/u)?.groups
      ?.id;

    if (video) {
      return {
        fetchUrl: `https://www.facebook.com/watch/?v=${video}`,
        id: video,
      };
    }
  }

  return undefined;
};

// The Facebook page scrape runs as an Effect program (FetchDeps Layer) and is
// bridged back to promises here, so resolve() keeps its thrown-Error contract.
const resolveFacebook = (
  sourceUrl: string,
  id: string,
  fetchUrl: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  return Effect.runPromise(
    Effect.mapError(
      Effect.provide(
        resolveFacebookProgram({ fetchUrl, id, sourceUrl }),
        layer
      ),
      toFacebookThrownError
    )
  );
};

// The catch-all fetch runs as an Effect program (FetchDeps Layer) and is
// bridged back to promises here, so resolve() keeps its thrown-Error contract.
// A video response's body is never read — only headers — so large files cost nothing.
const resolveGeneric = (
  sourceUrl: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  return Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveGenericProgram({ sourceUrl }), layer),
      toGenericThrownError
    )
  );
};

const resolveYouTube = async (
  sourceUrl: string,
  id: string,
  getFormats: (
    id: string,
    deps?: YouTubeDeps
  ) => Promise<TubeAsset[]> | TubeAsset[]
): Promise<VideoAsset[]> => {
  // renditions of one video, not separate videos: one labeled asset per distinct quality
  const formats = await getFormats(id);

  const assets = byQuality(
    formats.map((f) => ({ height: f.height, title: f.title, url: f.videoUrl }))
  ).map((f) => ({
    label: renditionLabel(f),
    platform: "youtube" as const,
    shortcode: id,
    sourceUrl,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    title: f.title,
    videoUrl: f.url,
  }));

  if (!assets.length) {
    throw new Error("No downloadable video found for this post.");
  }

  return assets;
};

// The X syndication flow runs as an Effect program (FetchDeps Layer) and is
// bridged back to promises here, so resolve() keeps its thrown-Error contract.
const resolveTwitter = (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  return Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveTwitterProgram({ id, sourceUrl }), layer),
      toTwitterThrownError
    )
  );
};

// Reddit posts with video: the .json endpoint exposes media.reddit_video.fallback_url
// (the direct mp4) plus a thumbnail. Crossposts carry the media on crosspost_parent_list.
const matchReddit = (
  sourceUrl: string
): { fetchUrl: string; id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (!hostMatches("reddit", host)) {
    return undefined;
  }

  // redd.it short links carry the id as the whole path
  if (host === "redd.it") {
    const [id] = url.pathname.slice(1).split("/");

    return id ? { fetchUrl: sourceUrl, id } : undefined;
  }

  const comments = url.pathname.match(/\/comments\/(?<id>[a-z0-9]+)/iu)?.groups
    ?.id;

  if (comments) {
    return { fetchUrl: sourceUrl, id: comments };
  }

  const rComments = url.pathname.match(
    /\/r\/[^/]+\/comments\/(?<id>[a-z0-9]+)/iu
  )?.groups?.id;

  if (rComments) {
    return { fetchUrl: sourceUrl, id: rComments };
  }

  return undefined;
};

// The Reddit listing fetch runs as an Effect program (FetchDeps Layer) and is
// bridged back to promises here, so resolve() keeps its thrown-Error contract.
const resolveReddit = (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  return Effect.runPromise(
    Effect.mapError(
      Effect.provide(
        resolveRedditProgram({ fetchUrl: sourceUrl, id, sourceUrl }),
        layer
      ),
      toRedditThrownError
    )
  );
};

const matchStreamable = (sourceUrl: string): { code: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (!hostMatches("streamable", host)) {
    return undefined;
  }

  const code = url.pathname.match(
    /^\/(?:o|s|e)?\/?(?<code>[A-Za-z0-9]+)(?:\/|$)/u
  )?.groups?.code;

  if (!code) {
    const [first] = url.pathname.slice(1).split("/");

    return first ? { code: first } : undefined;
  }

  return { code };
};

// The Streamable API fetch runs as an Effect program (FetchDeps Layer) and is
// bridged back to promises here, so resolve() keeps its thrown-Error contract.
const resolveStreamable = (
  sourceUrl: string,
  code: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  return Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveStreamableProgram({ code, sourceUrl }), layer),
      toStreamableThrownError
    )
  );
};

const matchVimeo = (
  sourceUrl: string
): { hash?: string; id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (!hostMatches("vimeo", host)) {
    return undefined;
  }

  const path = url.pathname;

  const videoMatch = path.match(
    /\/video\/(?<id>\d+)(?:\/(?<hash>[A-Za-z0-9]+))?/u
  );

  if (videoMatch?.groups?.id) {
    return { hash: videoMatch.groups.hash, id: videoMatch.groups.id };
  }

  const direct = path.match(/^\/(?<id>\d+)(?:\/(?<hash>[A-Za-z0-9]+))?/u);

  if (direct?.groups?.id) {
    return { hash: direct.groups.hash, id: direct.groups.id };
  }

  return undefined;
};

// The Vimeo player-config fetch runs as an Effect program (FetchDeps Layer)
// and is bridged back to promises here, so resolve() keeps its thrown-Error contract.
const resolveVimeo = (
  sourceUrl: string,
  id: string,
  hash: string | undefined,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  return Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveVimeoProgram({ hash, id, sourceUrl }), layer),
      toVimeoThrownError
    )
  );
};

const matchTikTok = (sourceUrl: string): { id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (!hostMatches("tiktok", host)) {
    return undefined;
  }

  const id = url.pathname.match(/\/video\/(?<id>\d+)/u)?.groups?.id;

  return id ? { id } : undefined;
};

// The TikTok page scrape runs as an Effect program (FetchDeps Layer) and is
// bridged back to promises here, so resolve() keeps its thrown-Error contract.
const resolveTikTok = (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  return Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveTikTokProgram({ id, sourceUrl }), layer),
      toTikTokThrownError
    )
  );
};

const matchThreads = (sourceUrl: string): { id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (!hostMatches("threads", host)) {
    return undefined;
  }

  const id =
    url.pathname.match(/\/(?:post|t)\/(?<id>[A-Za-z0-9_-]+)/u)?.groups?.id ??
    // eslint-disable-next-line unicorn/prefer-array-find -- last non-empty path segment, not a filtered first match
    url.pathname.split("/").filter(Boolean).at(-1);

  return id ? { id } : undefined;
};

// The Threads page scrape runs as an Effect program (FetchDeps Layer) and is
// bridged back to promises here, so resolve() keeps its thrown-Error contract.
const resolveThreads = async (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  const streams = await Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveThreadsProgram({ sourceUrl }), layer),
      toThreadsThrownError
    )
  );

  return [
    {
      platform: "threads" as const,
      shortcode: id,
      sourceUrl,
      thumbnail: streams.thumbnail,
      videoUrl: streams.videoUrl,
    },
  ];
};

const matchDailymotion = (sourceUrl: string): { id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (host === "dai.ly") {
    const [id] = url.pathname.slice(1).split("/");

    return id ? { id } : undefined;
  }

  if (!hostMatches("dailymotion", host)) {
    return undefined;
  }

  const id = url.pathname.match(
    /\/(?:video|embed\/video)\/(?<id>[A-Za-z0-9]+)/u
  )?.groups?.id;

  return id ? { id } : undefined;
};

// The Dailymotion metadata fetch runs as an Effect program (FetchDeps Layer)
// and is bridged back to promises here, so resolve() keeps its thrown-Error
// contract.
const resolveDailymotion = (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  return Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveDailymotionProgram({ id, sourceUrl }), layer),
      toDailymotionThrownError
    )
  );
};

const matchRumble = (
  sourceUrl: string
): { direct: boolean; id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  if (!hostMatches("rumble", url.hostname.toLowerCase())) {
    return undefined;
  }

  // Rumble ids carry their leading v (v1a2b3c); the embed page uses the same form
  const embed = url.pathname.match(/^\/embed\/(?<id>v[A-Za-z0-9]+)\/?$/u)
    ?.groups?.id;

  if (embed) {
    return { direct: true, id: embed };
  }

  const watch = url.pathname.match(/^\/v(?<id>[A-Za-z0-9]+)(?:[.-]|$)/u)?.groups
    ?.id;

  return watch ? { direct: false, id: `v${watch}` } : undefined;
};

// The Rumble flow runs as an Effect program (FetchDeps Layer) and is bridged
// back to promises here, so resolve() keeps its thrown-Error contract while
// the platform reasons in typed RumbleError tags.
const resolveRumble = async (
  sourceUrl: string,
  id: string,
  direct: boolean,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  const streams = await Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveRumbleProgram({ direct, id, sourceUrl }), layer),
      (error) => new Error(rumbleErrorMessage(error))
    )
  );

  const { html, mp4s } = streams;

  // renditions of one VOD, not separate videos: one labeled asset per rung,
  // best first — the same picker YouTube gets.
  return byQuality(mp4s.map((m) => ({ height: m.meta?.h, url: m.url }))).map(
    (m) => ({
      label: renditionLabel(m),
      platform: "rumble" as const,
      shortcode: id,
      sourceUrl,
      thumbnail: html === undefined ? undefined : extractThumbnail(html),
      videoUrl: m.url,
    })
  );
};

const matchLoom = (sourceUrl: string): { id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (!hostMatches("loom", host)) {
    return undefined;
  }

  const id = url.pathname.match(/\/(?:share|embed)\/(?<id>[A-Za-z0-9]+)/u)
    ?.groups?.id;

  return id ? { id } : undefined;
};

// The Loom page scrape runs as an Effect program (FetchDeps Layer) and is
// bridged back to promises here, so resolve() keeps its thrown-Error contract.
const resolveLoom = async (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const layer = Layer.succeed(FetchDeps)({
    doFetch: ctx.doFetch,
    lookup: ctx.lookup,
  });

  const streams = await Effect.runPromise(
    Effect.mapError(
      Effect.provide(resolveLoomProgram({ sourceUrl }), layer),
      toLoomThrownError
    )
  );

  return [
    {
      platform: "loom" as const,
      shortcode: id,
      sourceUrl,
      thumbnail: streams.thumbnail,
      videoUrl: streams.videoUrl,
    },
  ];
};

// async only so sync validation throws reject the promise instead of
// throwing synchronously — callers uniformly await
// eslint-disable-next-line require-await, complexity -- dispatch over supported providers; async for uniform await contract
const resolveRaw = async (
  sourceUrl: string,
  deps: MediaResolverDeps = {}
): Promise<VideoAsset[]> => {
  const trimmed = sourceUrl.trim();

  if (!trimmed) {
    throw new Error(EMPTY_LINK);
  }

  const ctx: FetchContext = {
    doFetch: deps.fetch ?? fetch,
    lookup: deps.lookup ?? defaultLookup,
  };

  const insta = instagramShortcode(trimmed);

  if (insta) {
    return resolveInstagram(canonicalReelUrl(trimmed), insta, ctx);
  }

  const fb = matchFacebookId(trimmed);

  if (fb) {
    return resolveFacebook(trimmed, fb.id, fb.fetchUrl, ctx);
  }

  const tweet = tweetId(trimmed);

  if (tweet) {
    return resolveTwitter(trimmed, tweet, ctx);
  }

  const reddit = matchReddit(trimmed);

  if (reddit) {
    return resolveReddit(trimmed, reddit.id, ctx);
  }

  const streamable = matchStreamable(trimmed);

  if (streamable) {
    return resolveStreamable(trimmed, streamable.code, ctx);
  }

  const vimeo = matchVimeo(trimmed);

  if (vimeo) {
    return resolveVimeo(trimmed, vimeo.id, vimeo.hash, ctx);
  }

  const tiktok = matchTikTok(trimmed);

  if (tiktok) {
    return resolveTikTok(trimmed, tiktok.id, ctx);
  }

  const threads = matchThreads(trimmed);

  if (threads) {
    return resolveThreads(trimmed, threads.id, ctx);
  }

  const dailymotion = matchDailymotion(trimmed);

  if (dailymotion) {
    return resolveDailymotion(trimmed, dailymotion.id, ctx);
  }

  const loom = matchLoom(trimmed);

  if (loom) {
    return resolveLoom(trimmed, loom.id, ctx);
  }

  const rumble = matchRumble(trimmed);

  if (rumble) {
    return resolveRumble(trimmed, rumble.id, rumble.direct, ctx);
  }

  const ytId = matchYouTubeId(trimmed);

  if (ytId) {
    return resolveYouTube(trimmed, ytId, deps.youtube ?? getYouTubeFormats);
  }

  if (!URL.parse(trimmed)) {
    throw new Error("Invalid URL. Paste a link to a video page or file.");
  }

  if (isKnownMediaHost(trimmed)) {
    throw new Error(
      "Invalid URL. On this host only a video post or file link is downloadable."
    );
  }

  return resolveGeneric(trimmed, ctx);
};

// One owner for the gif fact. A resolver that only saw a URL (an og:video from
// another platform) still gets a real gif recognized here; the client never
// has to re-derive it from the path.
export const resolve = async (
  sourceUrl: string,
  deps: MediaResolverDeps = {}
): Promise<VideoAsset[]> => {
  const assets = await resolveRaw(sourceUrl, deps);

  return assets.map((asset) =>
    asset.gif === undefined && containerOf(asset.videoUrl) === "gif"
      ? { ...asset, gif: "file" }
      : asset
  );
};
