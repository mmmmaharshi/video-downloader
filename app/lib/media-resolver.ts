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

export type Platform =
  | "instagram"
  | "twitter"
  | "youtube"
  | "facebook"
  | "direct";

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

// async only so sync validation throws reject the promise instead of
// throwing synchronously — callers uniformly await
// eslint-disable-next-line require-await
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

  const ytId = matchYouTubeId(trimmed);
  if (ytId) {
    return resolveYouTube(trimmed, ytId, deps.youtube ?? getYouTubeFormats);
  }

  if (!URL.parse(trimmed)) {
    throw new Error("Invalid URL. Paste a link to a video page or file.");
  }
  if (isKnownMediaHost(trimmed)) {
    throw new Error(
      "Invalid URL. Use an instagram.com post/reel, a facebook.com reel/video, an x.com status link, or a YouTube video link."
    );
  }
  return resolveGeneric(trimmed, doFetch, deps.lookup ?? defaultLookup);
};
