// Module: MediaResolver — deep module per CONTEXT.md
// Interface: resolve(sourceUrl, deps?) → VideoAsset[]
// A post can hold several videos (X lists them all in mediaDetails); Instagram's page
// exposes at most one, so IG resolves to a one-element list.
// Seam: fetch (live in prod, in-memory fixtures in tests — two adapters = real seam)

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { CHROME_UA, UA } from "./user-agent";
import { getYouTubeFormats } from "./youtube";
import type { TubeAsset, YouTubeDeps } from "./youtube";

export const PLATFORMS = [
  "instagram",
  "twitter",
  "youtube",
  "facebook",
  "reddit",
  "streamable",
  "vimeo",
  "tiktok",
  "threads",
  "dailymotion",
  "loom",
  "direct",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface VideoAsset {
  videoUrl: string;
  thumbnail?: string;
  shortcode: string;
  sourceUrl: string;
  platform: Platform;
  label?: string;
  title?: string;
}

export interface MediaResolverDeps {
  fetch?: typeof fetch;
  youtube?: (
    id: string,
    deps?: YouTubeDeps
  ) => Promise<TubeAsset[]> | TubeAsset[];
  lookup?: HostLookup;
}

// DNS seam: production resolves for real, tests inject addresses.
// Both sync and async doubles work — every use site awaits.
export type HostLookup = (hostname: string) => Promise<string[]> | string[];

const defaultLookup: HostLookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true });

  return records.map((r) => r.address);
};

const INSTA_RE =
  /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reels?|tv)\/(?<shortcode>[A-Za-z0-9_-]+)\/?(?:\?.*)?$/u;

const TWEET_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(?:[^/?#]+\/)*status(?:es)?\/(?<id>\d+)(?:[/?#]|$)/iu;

const FETCH_TIMEOUT_MS = 15_000;

const PAGE_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": CHROME_UA,
};

// probing for a file, not a page: accept whatever the host serves
const FILE_HEADERS = { ...PAGE_HEADERS, Accept: "*/*" };

const fetchPage = (
  doFetch: typeof fetch,
  url: string,
  headers: typeof PAGE_HEADERS = PAGE_HEADERS
): Promise<Response> =>
  doFetch(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

// Server-side fetch of a user-supplied link must never reach the private
// network: every hop (redirects included) resolves against a blocklist first.
// (Explicit range checks — Bun's net.BlockList mishandles IPv6.)
const isBlockedIPV4 = (addr: string): boolean => {
  const [a, b] = addr.split(".").map(Number);

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 168)
  );
};

const isBlockedIPV6 = (addr: string): boolean => {
  const n = addr.toLowerCase();
  // mapped-in-v6 IPv4 (e.g. ::ffff:127.0.0.1) judges by the embedded address
  const mapped = n.match(/^::ffff:(?<ipv4>\d+\.\d+\.\d+\.\d+)$/u)?.groups?.ipv4;

  if (mapped) {
    return isBlockedIPV4(mapped);
  }

  const [first] = n.split(":");

  // fe80 split
  // fe80::/10: first hextet fe80–febf, i.e. second hex digit 8–b
  return (
    n === "::" ||
    n === "::1" ||
    /^0(?::0){6,7}(?::1)?$/u.test(n) ||
    first.startsWith("fc") ||
    first.startsWith("fd") ||
    first.startsWith("ff") ||
    /^fe[89ab]/u.test(first)
  );
};

const isBlockedAddress = (addr: string): boolean => {
  if (isIP(addr) === 4) {
    return isBlockedIPV4(addr);
  }

  if (isIP(addr) === 6) {
    return isBlockedIPV6(addr);
  }

  return true;
};

const assertPublicHost = async (
  url: string,
  lookup: HostLookup
): Promise<void> => {
  let addresses: string[];

  try {
    addresses = await lookup(new URL(url).hostname);
  } catch {
    throw new Error("Could not resolve this link. Check the URL.");
  }

  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new Error("Only public links are supported.");
  }
};

const MAX_REDIRECTS = 4;

const fetchPublic = async (
  doFetch: typeof fetch,
  url: string,
  lookup: HostLookup,
  headers: typeof PAGE_HEADERS
): Promise<{ res: Response; url: string }> => {
  let current = url;

  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    // eslint-disable-next-line no-await-in-loop -- chain stays sequential: each hop feeds the next lookup
    await assertPublicHost(current, lookup);

    // eslint-disable-next-line no-await-in-loop -- response needed before following the redirect
    const res = await doFetch(current, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const location =
      res.status >= 300 && res.status < 400
        ? res.headers.get("location")
        : null;

    if (!location) {
      return { res, url: current };
    }

    try {
      current = new URL(location, current).href;
    } catch {
      throw new Error("This link redirects somewhere invalid.");
    }
  }

  throw new Error("This link redirects too many times.");
};

// a supported host with an unrecognized path is a mistyped platform link,
// not a generic page — fail fast instead of fetching it
// last path segment without its extension, for download filenames
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

const KNOWN_MEDIA_HOSTS = [
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "twitter.com",
  "x.com",
  "reddit.com",
  "redd.it",
  "streamable.com",
  "loom.com",
  "dai.ly",
  "dailymotion.com",
  "threads.net",
  "threads.com",
  "tiktok.com",
  "vimeo.com",
  "player.vimeo.com",
  "youtube.com",
  "youtu.be",
];

const isKnownMediaHost = (sourceUrl: string): boolean => {
  const host = new URL(sourceUrl).hostname.toLowerCase();

  return KNOWN_MEDIA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
};

// Instagram answers the plural /reels/ route with a login redirect for anonymous
// fetches while /reel/ serves the same post: fetch the canonical singular form.
const canonicalReelUrl = (url: string): string =>
  url.replace("instagram.com/reels/", "instagram.com/reel/");

const normalizeUrl = (raw: string): string =>
  raw
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&");

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

  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
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

const extractOgVideo = (html: string): string | undefined => {
  const v =
    html.match(
      /<meta\s+property="og:video:secure_url"\s+content="(?<url>[^"]+)"/u
    )?.groups?.url ??
    html.match(/<meta\s+property="og:video"\s+content="(?<url>[^"]+)"/u)?.groups
      ?.url ??
    html.match(/"video_url"\s*:\s*"(?<url>[^"]+)"/u)?.groups?.url ??
    html.match(/"videoUrl"\s*:\s*"(?<url>[^"]+)"/u)?.groups?.url;

  return v ? normalizeUrl(v) : undefined;
};

const extractThumbnail = (html: string): string | undefined =>
  html
    .match(/<meta\s+property="og:image"\s+content="(?<url>[^"]+)"/u)
    ?.groups?.url?.replaceAll("&amp;", "&");

// both resolvers diagnose a failed upstream the same way
const assertOk = (res: Response, upstream: string): void => {
  if (res.status === 404) {
    throw new Error("Post not found. Check the URL.");
  }

  if (!res.ok) {
    throw new Error(`${upstream} returned ${res.status}. Try again later.`);
  }
};

const resolveInstagram = async (
  sourceUrl: string,
  shortcode: string,
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  const res = await fetchPage(doFetch, sourceUrl);

  // more specific than the status itself: a login redirect is a private post, not a bad link
  if (res.redirected && res.url.includes("/accounts/login")) {
    throw new Error(
      "Private or login-required post. Only public posts are supported."
    );
  }

  assertOk(res, "Instagram");

  const html = await res.text();

  if (html.includes("/accounts/login") && !html.includes("og:video")) {
    throw new Error("Private post or requires login. Only public posts work.");
  }

  let videoUrl = extractOgVideo(html);

  // embed fallback — double-escaped JSON in embed HTML
  if (!videoUrl) {
    try {
      let embedKind = "p";

      if (sourceUrl.includes("/reel")) {
        embedKind = "reel";
      } else if (sourceUrl.includes("/tv/")) {
        embedKind = "tv";
      }

      const embedUrl = `https://www.instagram.com/${embedKind}/${shortcode}/embed/captioned/`;

      const er = await doFetch(embedUrl, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (er.ok) {
        const ehtml = await er.text();

        const evRaw =
          ehtml.match(
            /(?:\\"|")video_url(?:\\"|")\s*:\s*(?:\\"|")(?<url>[^"]+)(?:\\"|")/u
          )?.groups?.url ??
          ehtml.match(
            /(?:\\"|")videoUrl(?:\\"|")\s*:\s*(?:\\"|")(?<url>[^"]+)(?:\\"|")/u
          )?.groups?.url;

        if (evRaw) {
          videoUrl = normalizeUrl(evRaw).replaceAll("\\", "");
        }
      }
    } catch {
      // swallow — handled by final throw
    }
  }

  if (!videoUrl) {
    throw new Error(
      "No video found. Only video/reel posts are downloadable, or IG changed its page."
    );
  }

  return [
    {
      platform: "instagram",
      shortcode,
      sourceUrl,
      thumbnail: extractThumbnail(html),
      videoUrl,
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

  if (host === "facebook.com" || host.endsWith(".facebook.com")) {
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

const extractFbFile = (html: string, key: string): string | undefined => {
  const v = html.match(new RegExp(`"${key}"\\s*:\\s*"(?<value>[^"]+)"`, "u"))
    ?.groups?.value;

  return v ? normalizeUrl(v) : undefined;
};

const resolveFacebook = async (
  sourceUrl: string,
  id: string,
  fetchUrl: string,
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  const res = await fetchPage(doFetch, fetchUrl);

  // a login redirect is the only reliable private signal: public pages carry
  // login links in their chrome, so page text must never decide this
  if (res.redirected && res.url.includes("facebook.com/login")) {
    throw new Error(
      "Private or login-required post. Only public posts are supported."
    );
  }

  assertOk(res, "Facebook");

  const html = await res.text();

  const videoUrl =
    extractFbFile(html, "browser_native_hd_url") ??
    extractOgVideo(html) ??
    extractFbFile(html, "browser_native_sd_url") ??
    extractFbFile(html, "hd_src") ??
    extractFbFile(html, "sd_src");

  if (!videoUrl) {
    throw new Error(
      "No downloadable video found. Only public video/reel posts work, and Facebook limits anonymous access to some of them."
    );
  }

  return [
    {
      platform: "facebook",
      shortcode: id,
      sourceUrl,
      thumbnail: extractThumbnail(html),
      videoUrl,
    },
  ];
};

// Catch-all for any other link: a video content-type resolves the link
// itself, otherwise the page's og:video tag is the last resort. The body of a
// video response is never read — only headers — so large files cost nothing.
const resolveGeneric = async (
  sourceUrl: string,
  doFetch: typeof fetch,
  lookup: HostLookup
): Promise<VideoAsset[]> => {
  const { res, url } = await fetchPublic(
    doFetch,
    sourceUrl,
    lookup,
    FILE_HEADERS
  );

  if (res.status === 404) {
    throw new Error("Post not found. Check the URL.");
  }

  if (!res.ok) {
    throw new Error(`This link returned ${res.status}. Try again later.`);
  }

  const shortcode = slugOf(url);
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.startsWith("video/")) {
    return [
      {
        platform: "direct",
        shortcode,
        sourceUrl,
        thumbnail: undefined,
        videoUrl: url,
      },
    ];
  }

  const html = await res.text();
  const videoUrl = extractOgVideo(html);

  if (!videoUrl) {
    throw new Error(
      "No video found at this link. Only pages and files that serve video are downloadable."
    );
  }

  return [
    {
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
  const seen = new Set<number>();
  const formats = await getFormats(id);

  const assets = formats
    .filter((f) => {
      if (seen.has(f.height)) {
        return false;
      }

      seen.add(f.height);

      return true;
    })
    .map((f) => ({
      label: f.height > 0 ? `${f.height}p` : undefined,
      platform: "youtube" as const,
      shortcode: id,
      sourceUrl,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      title: f.title,
      videoUrl: f.videoUrl,
    }));

  if (!assets.length) {
    throw new Error("No downloadable video found for this post.");
  }

  return assets;
};

interface SyndicationMedia {
  type?: string;
  media_url_https?: string;
  video_info?: {
    variants?: { bitrate?: number; content_type: string; url: string }[];
  };
}

interface SyndicationTweet {
  id_str?: string;
  mediaDetails?: SyndicationMedia[];
}

const resolveTwitter = async (
  sourceUrl: string,
  id: string,
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  // the token is the web client's derivation from the tweet id; an absent token returns an empty payload
  // shortcut: X does not validate this token today and the derivation divides an id above 2^53 as a float — derive it exactly if X ever starts rejecting tokens
  const token = ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replaceAll(/(?:0+|\.)/gu, "");

  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`;

  const res = await doFetch(endpoint, {
    headers: { Accept: "application/json", "User-Agent": CHROME_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  assertOk(res, "X");

  // this endpoint answers with HTML on some failure paths and with {} when the token is missing
  let tweet: SyndicationTweet;

  try {
    tweet = await res.json();
  } catch {
    throw new Error("X returned an unexpected response. Try again later.");
  }

  if (!tweet.id_str) {
    throw new Error("X returned an unexpected response. Try again later.");
  }

  // an animated_gif is an mp4 on X too; it carries a single variant with bitrate 0
  const videos = (tweet.mediaDetails ?? []).filter(
    (m) => m.type === "video" || m.type === "animated_gif"
  );

  if (!videos.length) {
    throw new Error("No video found. Only video posts are downloadable.");
  }

  // a tweet can hold several videos: keep the best mp4 of each, in post order
  // (sort runs on the filtered copy, so nothing shared is mutated — toSorted
  // needs ES2023 lib, which this project does not target)
  const assets: VideoAsset[] = [];

  // (the sort runs on the per-tweet filtered copy — toSorted needs ES2023 lib)
  // (sort runs on the per-tweet filtered copy: toSorted needs ES2023 lib)
  for (const video of videos) {
    const [mp4] = (video.video_info?.variants ?? [])
      .filter((v) => v.content_type === "video/mp4")
      // eslint-disable-next-line unicorn/no-array-sort -- per-tweet filtered copy, nothing shared
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

    if (mp4) {
      assets.push({
        platform: "twitter",
        shortcode: id,
        sourceUrl,
        thumbnail: video.media_url_https,
        videoUrl: mp4.url,
      });
    }
  }

  if (!assets.length) {
    throw new Error("No downloadable video found for this post.");
  }

  return assets;
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

  if (
    host !== "reddit.com" &&
    !host.endsWith(".reddit.com") &&
    host !== "redd.it"
  ) {
    return undefined;
  }

  // redd.it short links: /{id}
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

const resolveReddit = async (
  sourceUrl: string,
  id: string,
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  const jsonUrl = `${sourceUrl.split("?")[0].replace(/\/+$/u, "")}.json`;

  const res = await doFetch(jsonUrl, {
    headers: { Accept: "application/json", "User-Agent": CHROME_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  assertOk(res, "Reddit");

  let listing: RedditListing[];

  try {
    listing = await res.json();
  } catch {
    throw new Error("Reddit returned an unexpected response. Try again later.");
  }

  const post = listing?.[0]?.data?.children?.[0]?.data;
  const data = post?.crosspost_parent_list?.[0] ?? post;

  const videoUrl = data?.media?.reddit_video?.fallback_url;

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

// Streamable: the API returns a files map with mp4 renditions + a thumbnail.
const matchStreamable = (sourceUrl: string): { code: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (host !== "streamable.com" && !host.endsWith(".streamable.com")) {
    return undefined;
  }

  const code = url.pathname.match(
    /^\/(?:o|s|e)?\/?(?<code>[A-Za-z0-9]+)(?:\/|$)/u
  )?.groups?.code;

  if (!code) {
    // bare /{code}
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
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  const res = await doFetch(`https://api.streamable.com/videos/${code}`, {
    headers: { Accept: "application/json", "User-Agent": CHROME_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  assertOk(res, "Streamable");

  let data: StreamableResponse;

  try {
    data = await res.json();
  } catch {
    throw new Error(
      "Streamable returned an unexpected response. Try again later."
    );
  }

  const mp4s = Object.values(data.files ?? {}).filter(
    (f): f is StreamableFile & { url: string } =>
      f.url !== undefined && /mp4/iu.test(f.url)
  );

  // pick the largest rendition
  // eslint-disable-next-line unicorn/no-array-sort -- sorts a fresh filtered copy
  const [best] = mp4s.sort(
    (a, b) => (b.width ?? b.height ?? 0) - (a.width ?? a.height ?? 0)
  );

  if (!best?.url) {
    throw new Error("No video found. Only video posts are downloadable.");
  }

  return [
    {
      platform: "streamable",
      shortcode: code,
      sourceUrl,
      thumbnail: data.thumbnail_url,
      title: data.title,
      videoUrl: best.url,
    },
  ];
};

// Vimeo: player config endpoint returns progressive mp4s + thumbs.
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

  if (
    host !== "vimeo.com" &&
    host !== "player.vimeo.com" &&
    !host.endsWith(".vimeo.com")
  ) {
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
  video?: {
    files?: { progressive?: VimeoProgressive[] };
    thumbs?: { base?: string; sizes?: { link?: string }[] } | string;
    title?: string;
  };
}

const resolveVimeo = async (
  sourceUrl: string,
  id: string,
  hash: string | undefined,
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  const configUrl = new URL(`https://player.vimeo.com/video/${id}/config`);

  if (hash) {
    configUrl.searchParams.set("h", hash);
  }

  const res = await doFetch(configUrl.href, {
    headers: { Accept: "application/json", "User-Agent": CHROME_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  assertOk(res, "Vimeo");

  let data: VimeoConfig;

  try {
    data = await res.json();
  } catch {
    throw new Error("Vimeo returned an unexpected response. Try again later.");
  }

  const progressive = data.video?.files?.progressive ?? [];

  const [best] = progressive
    .filter((p): p is VimeoProgressive & { url: string } => p.url !== undefined)
    // eslint-disable-next-line unicorn/no-array-sort -- sorts a fresh filtered copy
    .sort((a, b) => (b.width ?? b.height ?? 0) - (a.width ?? a.height ?? 0));

  if (!best?.url) {
    throw new Error("No video found. Only public videos are downloadable.");
  }

  const thumbs = data.video?.thumbs;

  const thumbnail =
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- Vimeo thumbs arrive as string or object from JSON; narrowing on the value is the only discriminator available
    typeof thumbs === "string"
      ? thumbs
      : (thumbs?.sizes?.[0]?.link ?? thumbs?.base);

  return [
    {
      platform: "vimeo",
      shortcode: id,
      sourceUrl,
      thumbnail,
      title: data.video?.title,
      videoUrl: best.url,
    },
  ];
};

// TikTok: the rehydration JSON carries playAddr (direct mp4); og:video is the fallback.
const matchTikTok = (sourceUrl: string): { id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) {
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

const resolveTikTok = async (
  sourceUrl: string,
  id: string,
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  const res = await fetchPage(doFetch, sourceUrl);

  assertOk(res, "TikTok");

  const html = await res.text();

  let videoUrl: string | undefined;
  let thumbnail: string | undefined;

  const rehydration = html.match(
    /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(?<json>.*?)<\/script>/su
  )?.groups?.json;

  if (rehydration) {
    try {
      const data = JSON.parse(rehydration);

      const video: TikTokVideo | undefined =
        data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct
          ?.video;

      videoUrl = video?.playAddr ?? video?.downloadAddr;
      thumbnail = video?.cover;
    } catch {
      // fall through to og:video
    }
  }

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

// Threads: Meta sibling of IG; og:video is the reliable signal.
const matchThreads = (sourceUrl: string): { id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (
    host !== "threads.net" &&
    host !== "threads.com" &&
    !host.endsWith(".threads.net") &&
    !host.endsWith(".threads.com")
  ) {
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
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  const res = await fetchPage(doFetch, sourceUrl);

  assertOk(res, "Threads");

  const html = await res.text();

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

// Dailymotion: metadata endpoint returns qualities map.
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

  if (host !== "dailymotion.com" && !host.endsWith(".dailymotion.com")) {
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
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  const res = await doFetch(
    `https://www.dailymotion.com/player/metadata/video/${id}`,
    {
      headers: { Accept: "application/json", "User-Agent": CHROME_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  );

  assertOk(res, "Dailymotion");

  let data: DailymotionMetadata;

  try {
    data = await res.json();
  } catch {
    throw new Error(
      "Dailymotion returned an unexpected response. Try again later."
    );
  }

  const qualities = data.qualities ?? {};

  // pick highest numeric quality, then "auto"
  // eslint-disable-next-line unicorn/no-array-sort -- sorts a fresh array from Object.keys
  const keys = Object.keys(qualities).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);

    if (Number.isNaN(an) || Number.isNaN(bn)) {
      return a === "auto" ? 1 : -1;
    }

    return bn - an;
  });

  let videoUrl: string | undefined;

  for (const key of keys) {
    const entries = qualities[key] ?? [];

    const mp4 = entries.find(
      (e) => e.url && /mp4/iu.test(e.type ?? e.url ?? "")
    );

    if (mp4?.url) {
      videoUrl = mp4.url;
      break;
    }

    if (entries[0]?.url) {
      videoUrl = entries[0].url;
      break;
    }
  }

  if (!videoUrl) {
    throw new Error("No video found. Only public videos are downloadable.");
  }

  return [
    {
      platform: "dailymotion",
      shortcode: id,
      sourceUrl,
      thumbnail: data.poster_url ?? data.thumbnail_url,
      title: data.title,
      videoUrl,
    },
  ];
};

// Loom: og:video carries the signed mp4.
const matchLoom = (sourceUrl: string): { id: string } | undefined => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase();

  if (host !== "loom.com" && !host.endsWith(".loom.com")) {
    return undefined;
  }

  const id = url.pathname.match(/\/(?:share|embed)\/(?<id>[A-Za-z0-9]+)/u)
    ?.groups?.id;

  return id ? { id } : undefined;
};

const resolveLoom = async (
  sourceUrl: string,
  id: string,
  doFetch: typeof fetch
): Promise<VideoAsset[]> => {
  const res = await fetchPage(doFetch, sourceUrl);

  assertOk(res, "Loom");

  const html = await res.text();

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
export const resolve = async (
  sourceUrl: string,
  deps: MediaResolverDeps = {}
): Promise<VideoAsset[]> => {
  const trimmed = sourceUrl.trim();

  if (!trimmed) {
    throw new Error("Paste a video link");
  }

  const doFetch = deps.fetch ?? fetch;

  const insta = trimmed.match(INSTA_RE)?.groups?.shortcode;

  if (insta) {
    return resolveInstagram(canonicalReelUrl(trimmed), insta, doFetch);
  }

  const fb = matchFacebookId(trimmed);

  if (fb) {
    return resolveFacebook(trimmed, fb.id, fb.fetchUrl, doFetch);
  }

  const tweet = trimmed.match(TWEET_RE)?.groups?.id;

  if (tweet) {
    return resolveTwitter(trimmed, tweet, doFetch);
  }

  const reddit = matchReddit(trimmed);

  if (reddit) {
    return resolveReddit(trimmed, reddit.id, doFetch);
  }

  const streamable = matchStreamable(trimmed);

  if (streamable) {
    return resolveStreamable(trimmed, streamable.code, doFetch);
  }

  const vimeo = matchVimeo(trimmed);

  if (vimeo) {
    return resolveVimeo(trimmed, vimeo.id, vimeo.hash, doFetch);
  }

  const tiktok = matchTikTok(trimmed);

  if (tiktok) {
    return resolveTikTok(trimmed, tiktok.id, doFetch);
  }

  const threads = matchThreads(trimmed);

  if (threads) {
    return resolveThreads(trimmed, threads.id, doFetch);
  }

  const dailymotion = matchDailymotion(trimmed);

  if (dailymotion) {
    return resolveDailymotion(trimmed, dailymotion.id, doFetch);
  }

  const loom = matchLoom(trimmed);

  if (loom) {
    return resolveLoom(trimmed, loom.id, doFetch);
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
      "Invalid URL. Use an instagram.com post/reel, a facebook.com reel/video, an x.com status link, a YouTube video link, a reddit.com post, a streamable.com link, a vimeo.com video, a tiktok.com video, a threads.net post, a dailymotion.com video, or a loom.com video."
    );
  }

  return resolveGeneric(trimmed, doFetch, deps.lookup ?? defaultLookup);
};
