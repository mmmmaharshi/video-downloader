// Module: MediaResolver — deep module per CONTEXT.md
// Interface: resolve(sourceUrl, deps?) → VideoAsset[]
// A post can hold several videos (X lists them all in mediaDetails); Instagram's page
// exposes at most one, so IG resolves to a one-element list.
// Seam: fetch (live in prod, in-memory fixtures in tests — two adapters = real seam)

import { Effect, Layer } from "effect";

import { readCappedUtf8 } from "./capped-body";
import { containerOf } from "./container";
import {
  resolveFacebookProgram,
  toThrownError as toFacebookThrownError,
} from "./facebook-effect";
import { FetchDeps } from "./fetch-deps";
import { fetchGuarded, FETCH_TIMEOUT_MS, PAGE_HEADERS } from "./guarded-fetch";
import { resolveInstagramProgram, toThrownError } from "./instagram-effect";
import { EMPTY_LINK } from "./messages";
import { extractOgVideo, extractThumbnail } from "./og-meta";
import { hostMatches, isPlatformHost } from "./platforms";
import { defaultLookup } from "./public-host";
import type { HostLookup } from "./public-host";
import { byQuality, preferMp4, renditionLabel } from "./renditions";
import type { Rendition } from "./renditions";
import type { VideoAsset } from "./resolve-query";
import { resolveRumbleProgram, rumbleErrorMessage } from "./rumble-effect";
import {
  resolveTwitterProgram,
  toThrownError as toTwitterThrownError,
} from "./twitter-effect";
import { CHROME_UA } from "./user-agent";
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

const NOT_FOUND = "Post not found. Check the URL.";

// probing for a file, not a page: accept whatever the host serves
const FILE_HEADERS = { ...PAGE_HEADERS, Accept: "*/*" };

// A page carrying og:video is small; a mislabelled binary is not. Read only the
// head of the body, so a 1GB file cannot be decoded into a string.
const MAX_PAGE_BYTES = 512 * 1024;

// an oversized page is truncated to its head; the JSON helpers below fail the
// parse instead. Both policies share one byte-accurate read.
const readCapped = async (res: Response, cap: number): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, cap);

  return text;
};

// JSON has no streaming parser here: read a capped string, then parse it. An
// oversized body fails the parse instead of being buffered without a limit.
const readCappedJson = async (res: Response) =>
  JSON.parse(await readCapped(res, MAX_PAGE_BYTES));

// one policy for every platform fetch: the guarded loop owns the hops, this
// wrapper owns the header stall timeout
const fetchPublic = (
  ctx: FetchContext,
  url: string,
  headers: BunFetchRequestInit["headers"]
): Promise<{ res: Response; url: string }> =>
  fetchGuarded(ctx, url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

// a supported host with an unrecognized path is a mistyped platform link,
// not a generic page — fail fast instead of fetching it
const slugOf = (sourceUrl: string): string => {
  const segments = new URL(sourceUrl).pathname.split("/");
  let last = "";

  for (const segment of segments) {
    if (segment) {
      last = segment;
    }
  }

  let stem: string;

  try {
    stem = decodeURIComponent(last).replace(/\.[a-z0-9]+$/iu, "");
  } catch {
    stem = last.replace(/\.[a-z0-9]+$/iu, "");
  }

  return stem || "video";
};

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

const assertOk = (res: Response, upstream: string): void => {
  if (res.status === 404) {
    throw new Error(NOT_FOUND);
  }

  if (!res.ok) {
    throw new Error(`${upstream} returned ${res.status}. Try again later.`);
  }
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

// Catch-all for any other link: a video or gif content-type resolves the link
// itself, otherwise the page's og:video tag is the last resort. The body of a
// video response is never read — only headers — so large files cost nothing.
const NO_VIDEO_FOUND =
  "No video found at this link. Only pages, video files, and GIFs are downloadable.";

const resolveGeneric = async (
  sourceUrl: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const { res, url } = await fetchPublic(ctx, sourceUrl, FILE_HEADERS);

  if (res.status === 404) {
    throw new Error(NOT_FOUND);
  }

  if (!res.ok) {
    throw new Error(`This link returned ${res.status}. Try again later.`);
  }

  const shortcode = slugOf(url);
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.startsWith("video/") || contentType.startsWith("image/gif")) {
    await res.body?.cancel();

    return [
      {
        gif: containerOf(url, contentType) === "gif" ? "file" : undefined,
        platform: "direct",
        shortcode,
        sourceUrl,
        thumbnail: undefined,
        videoUrl: url,
      },
    ];
  }

  // only a page carries og:video; anything else is a file or an API body
  const isPage =
    contentType === "" ||
    /^(?:text\/|application\/(?:xhtml\+xml|xml))/u.test(contentType);

  if (!isPage) {
    throw new Error(NO_VIDEO_FOUND);
  }

  const html = await readCapped(res, MAX_PAGE_BYTES);
  const videoUrl = extractOgVideo(html);

  if (!videoUrl) {
    throw new Error(NO_VIDEO_FOUND);
  }

  return [
    {
      gif: undefined,
      platform: "direct",
      shortcode,
      sourceUrl,
      thumbnail: extractThumbnail(html),
      videoUrl,
    },
  ];
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

interface RedditMedia {
  reddit_video?: { fallback_url?: string; hls_url?: string };
}

interface RedditPost {
  data?: {
    crosspost_parent_list?: RedditPost["data"][];
    id?: string;
    media?: RedditMedia;
    thumbnail?: string;
    title?: string;
  };
}

interface RedditListing {
  data?: { children?: { data?: RedditPost["data"] }[] };
}

// eslint-disable-next-line complexity -- dispatch over reddit post shapes (crosspost, media, embeds); splitting would scatter the same data flow
const resolveReddit = async (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const jsonUrl = `${sourceUrl.split("?")[0].replace(/\/+$/u, "")}.json`;

  const { res } = await fetchPublic(ctx, jsonUrl, {
    Accept: "application/json",
    "User-Agent": CHROME_UA,
  });

  assertOk(res, "Reddit");

  let listing: RedditListing[];

  try {
    listing = await readCappedJson(res);
  } catch {
    throw new Error("Reddit returned an unexpected response. Try again later.");
  }

  const post = listing?.[0]?.data?.children?.[0]?.data;
  const data = post?.crosspost_parent_list?.[0] ?? post;

  const videoUrl =
    data?.media?.reddit_video?.fallback_url ??
    data?.media?.reddit_video?.hls_url;

  if (!videoUrl) {
    throw new Error("No video found. Only video posts are downloadable.");
  }

  const thumbnail =
    data?.thumbnail && data.thumbnail.startsWith("http")
      ? data.thumbnail
      : undefined;

  return [
    {
      platform: "reddit",
      shortcode: id,
      sourceUrl,
      thumbnail,
      title: data?.title,
      videoUrl,
    },
  ];
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

interface StreamableFile {
  height?: number;
  url?: string;
  width?: number;
}

interface StreamableResponse {
  files?: Record<string, StreamableFile>;
  thumbnail_url?: string;
  title?: string;
}

const resolveStreamable = async (
  sourceUrl: string,
  code: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const { res } = await fetchPublic(
    ctx,
    `https://api.streamable.com/videos/${code}`,
    {
      Accept: "application/json",
      "User-Agent": CHROME_UA,
    }
  );

  assertOk(res, "Streamable");

  let data: StreamableResponse;

  try {
    data = await readCappedJson(res);
  } catch {
    throw new Error(
      "Streamable returned an unexpected response. Try again later."
    );
  }

  const files = Object.values(data.files ?? {}).filter(
    (f): f is StreamableFile & { url: string } => f.url !== undefined
  );

  const mp4s = files.filter((f) => /mp4/iu.test(f.url));

  const assets = byQuality(preferMp4(mp4s, files)).map((f) => ({
    label: renditionLabel(f),
    platform: "streamable" as const,
    shortcode: code,
    sourceUrl,
    thumbnail: data.thumbnail_url,
    title: data.title,
    // Streamable serves the url with a doubled scheme ("https:https://..."); collapse it.
    videoUrl: f.url.replace(/^https?:https:\/\//u, "https://"),
  }));

  if (!assets.length) {
    throw new Error("No video found. Only video posts are downloadable.");
  }

  return assets;
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

interface VimeoProgressive {
  height?: number;
  quality?: string;
  url?: string;
  width?: number;
}

interface VimeoConfig {
  request?: {
    files?: { progressive?: VimeoProgressive[]; hls?: { url?: string } };
  };
  video?: {
    files?: { progressive?: VimeoProgressive[] };
    thumbnail_url?: string;
    title?: string;
  };
}

const resolveVimeo = async (
  sourceUrl: string,
  id: string,
  hash: string | undefined,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const configUrl = new URL(`https://player.vimeo.com/video/${id}/config`);

  if (hash) {
    configUrl.searchParams.set("h", hash);
  }

  const { res } = await fetchPublic(ctx, configUrl.href, {
    Accept: "application/json",
    Referer: `https://player.vimeo.com/video/${id}`,
    "User-Agent": CHROME_UA,
  });

  assertOk(res, "Vimeo");

  let data: VimeoConfig;

  try {
    data = await readCappedJson(res);
  } catch {
    throw new Error("Vimeo returned an unexpected response. Try again later.");
  }

  const progressive = (
    data.video?.files?.progressive ??
    data.request?.files?.progressive ??
    []
  ).filter((p): p is VimeoProgressive & { url: string } => p.url !== undefined);

  const hls = data.request?.files?.hls?.url;

  const renditions: Rendition[] = progressive.map((p) => ({
    height: p.height,
    label: p.quality,
    url: p.url,
    width: p.width,
  }));

  // Vimeo only ships HLS where no progressive file exists
  if (renditions.length === 0 && hls) {
    renditions.push({ url: hls });
  }

  const assets = byQuality(renditions).map((r) => ({
    label: renditionLabel(r),
    platform: "vimeo" as const,
    shortcode: id,
    sourceUrl,
    thumbnail: data.video?.thumbnail_url,
    title: data.video?.title,
    videoUrl: r.url,
  }));

  if (!assets.length) {
    throw new Error("No video found. Only public videos are downloadable.");
  }

  return assets;
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

interface TikTokVideo {
  cover?: string;
  downloadAddr?: string;
  playAddr?: string;
}

// Broken rehydration JSON falls through to og:video below, so a bad parse is
// undefined here rather than an error.
const parseTikTokVideo = (html: string): TikTokVideo | undefined => {
  const rehydration = html.match(
    /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(?<json>.*?)<\/script>/su
  )?.groups?.json;

  if (!rehydration) {
    return undefined;
  }

  try {
    const data = JSON.parse(rehydration);

    return data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo
      ?.itemStruct?.video;
  } catch {
    return undefined;
  }
};

const resolveTikTok = async (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const { res } = await fetchPublic(ctx, sourceUrl, PAGE_HEADERS);

  assertOk(res, "TikTok");

  const html = await readCapped(res, MAX_PAGE_BYTES);

  const video = parseTikTokVideo(html);

  let videoUrl = video?.playAddr ?? video?.downloadAddr;
  let thumbnail = video?.cover;

  videoUrl ??= extractOgVideo(html);
  thumbnail ??= extractThumbnail(html);

  if (!videoUrl) {
    throw new Error(
      "No video found. Only public videos are downloadable, and TikTok limits anonymous access."
    );
  }

  return [
    {
      platform: "tiktok",
      shortcode: id,
      sourceUrl,
      thumbnail,
      videoUrl,
    },
  ];
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

const resolveThreads = async (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const { res } = await fetchPublic(ctx, sourceUrl, PAGE_HEADERS);

  assertOk(res, "Threads");

  const html = await readCapped(res, MAX_PAGE_BYTES);

  const videoUrl = extractOgVideo(html);

  if (!videoUrl) {
    throw new Error("No video found. Only video posts are downloadable.");
  }

  return [
    {
      platform: "threads",
      shortcode: id,
      sourceUrl,
      thumbnail: extractThumbnail(html),
      videoUrl,
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

interface DailymotionQuality {
  type?: string;
  url?: string;
}

interface DailymotionMetadata {
  poster_url?: string;
  qualities?: Record<string, DailymotionQuality[]>;
  thumbnail_url?: string;
  title?: string;
}

const resolveDailymotion = async (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const { res } = await fetchPublic(
    ctx,
    `https://www.dailymotion.com/player/metadata/video/${id}`,
    { Accept: "application/json", "User-Agent": CHROME_UA }
  );

  assertOk(res, "Dailymotion");

  let data: DailymotionMetadata;

  try {
    data = await readCappedJson(res);
  } catch {
    throw new Error(
      "Dailymotion returned an unexpected response. Try again later."
    );
  }

  const qualities = data.qualities ?? {};

  const renditions: Rendition[] = Object.entries(qualities).flatMap(
    ([key, entries]): Rendition[] => {
      const mp4 = entries?.find(
        (e) => e.url && /mp4/iu.test(e.type ?? e.url ?? "")
      );

      const url = mp4?.url ?? entries?.find((e) => e.url)?.url;

      if (!url) {
        return [];
      }

      const height = Number(key);

      return Number.isNaN(height) ? [{ label: key, url }] : [{ height, url }];
    }
  );

  const assets = byQuality(renditions).map((r) => ({
    label: renditionLabel(r),
    platform: "dailymotion" as const,
    shortcode: id,
    sourceUrl,
    thumbnail: data.poster_url ?? data.thumbnail_url,
    title: data.title,
    videoUrl: r.url,
  }));

  if (!assets.length) {
    throw new Error("No video found. Only public videos are downloadable.");
  }

  return assets;
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

const resolveLoom = async (
  sourceUrl: string,
  id: string,
  ctx: FetchContext
): Promise<VideoAsset[]> => {
  const { res } = await fetchPublic(ctx, sourceUrl, PAGE_HEADERS);

  assertOk(res, "Loom");

  const html = await readCapped(res, MAX_PAGE_BYTES);

  const videoUrl = extractOgVideo(html);

  if (!videoUrl) {
    throw new Error("No video found. Only public videos are downloadable.");
  }

  return [
    {
      platform: "loom",
      shortcode: id,
      sourceUrl,
      thumbnail: extractThumbnail(html),
      videoUrl,
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
