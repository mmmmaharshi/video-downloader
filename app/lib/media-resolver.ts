// Module: MediaResolver — deep module per CONTEXT.md
// Interface: resolve(sourceUrl, deps?) → VideoAsset[]
// A post can hold several videos (X lists them all in mediaDetails); Instagram's page
// exposes at most one, so IG resolves to a one-element list.
// Seam: fetch (live in prod, in-memory fixtures in tests — two adapters = real seam)

import { CHROME_UA, UA } from "./user-agent";
import { getYouTubeFormats } from "./youtube";

export type Platform = "instagram" | "twitter" | "youtube";

export type VideoAsset = {
  videoUrl: string;
  thumbnail?: string;
  shortcode: string;
  sourceUrl: string;
  platform: Platform;
};

export type MediaResolverDeps = {
  fetch?: typeof fetch;
  youtube?: typeof getYouTubeFormats;
};

const INSTA_RE = /^https?:\/\/(?:www\.)?instagram\.com\/(p|reels?|tv)\/([A-Za-z0-9_-]+)\/?(\?.*)?$/;
const TWEET_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(?:[^/?#]+\/)*status(?:es)?\/(\d+)(?:[/?#]|$)/i;
const FETCH_TIMEOUT_MS = 15_000;

export async function resolve(sourceUrl: string, deps: MediaResolverDeps = {}): Promise<VideoAsset[]> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) throw new Error("Paste an Instagram or X link");

  const doFetch = deps.fetch ?? fetch;

  const insta = trimmed.match(INSTA_RE);
  if (insta) return resolveInstagram(canonicalReelUrl(trimmed), insta[2], doFetch);

  const tweet = trimmed.match(TWEET_RE);
  if (tweet) return resolveTwitter(trimmed, tweet[1], doFetch);

  const ytId = matchYouTubeId(trimmed);
  if (ytId) return resolveYouTube(trimmed, ytId, deps.youtube ?? getYouTubeFormats);

  throw new Error("Invalid URL. Use an instagram.com post/reel, an x.com status link, or a YouTube video link.");
}

// Instagram answers the plural /reels/ route with a login redirect for anonymous
// fetches while /reel/ serves the same post: fetch the canonical singular form.
function canonicalReelUrl(url: string): string {
  return url.replace("instagram.com/reels/", "instagram.com/reel/");
}

function normalizeUrl(raw: string): string {
  return raw.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
}

// A watch page is identified by its 11-char id, wherever it sits: watch?v= (any param
// order), youtu.be, /shorts/, /live/, /embed/. A regex cannot read query params, so parse.
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
function matchYouTubeId(sourceUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return YT_ID_RE.test(id) ? id : undefined;
  }
  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const v = url.searchParams.get("v");
    if (v && YT_ID_RE.test(v)) return v;
    const pathId = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1];
    if (pathId) return pathId;
  }
  return undefined;
}

function extractOgVideo(html: string): string | undefined {
  const v =
    html.match(/<meta\s+property="og:video:secure_url"\s+content="([^"]+)"/)?.[1] ??
    html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/)?.[1] ??
    html.match(/"video_url"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/"videoUrl"\s*:\s*"([^"]+)"/)?.[1];
  return v ? normalizeUrl(v) : undefined;
}

function extractThumbnail(html: string): string | undefined {
  return html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
}

// both resolvers diagnose a failed upstream the same way
function assertOk(res: Response, upstream: string): void {
  if (res.status === 404) throw new Error("Post not found. Check the URL.");
  if (!res.ok) throw new Error(`${upstream} returned ${res.status}. Try again later.`);
}

async function resolveInstagram(sourceUrl: string, shortcode: string, doFetch: typeof fetch): Promise<VideoAsset[]> {
  const res = await doFetch(sourceUrl, {
    headers: {
      "User-Agent": CHROME_UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  // more specific than the status itself: a login redirect is a private post, not a bad link
  if (res.redirected && res.url.includes("/accounts/login")) {
    throw new Error("Private or login-required post. Only public posts are supported.");
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
      const embedKind = sourceUrl.includes("/reel") ? "reel" : sourceUrl.includes("/tv/") ? "tv" : "p";
      const embedUrl = `https://www.instagram.com/${embedKind}/${shortcode}/embed/captioned/`;
      const er = await doFetch(embedUrl, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (er.ok) {
        const ehtml = await er.text();
        const evRaw =
          ehtml.match(/(?:\\"|")video_url(?:\\"|")\s*:\s*(?:\\"|")([^"]+)(?:\\"|")/)?.[1] ??
          ehtml.match(/(?:\\"|")videoUrl(?:\\"|")\s*:\s*(?:\\"|")([^"]+)(?:\\"|")/)?.[1];
        if (evRaw) videoUrl = normalizeUrl(evRaw).replace(/\\/g, "");
      }
    } catch {
      // swallow — handled by final throw
    }
  }

  if (!videoUrl) throw new Error("No video found. Only video/reel posts are downloadable, or IG changed its page.");

  return [{ videoUrl, thumbnail: extractThumbnail(html), shortcode, sourceUrl, platform: "instagram" }];
}

async function resolveYouTube(
  sourceUrl: string,
  id: string,
  getFormats: typeof getYouTubeFormats,
): Promise<VideoAsset[]> {
  // one watch page is one video: the formats are renditions, so only the best ships
  const best = (await getFormats(id))[0];
  if (!best) throw new Error("No downloadable video found for this post.");

  return [
    {
      videoUrl: best.videoUrl,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      shortcode: id,
      sourceUrl,
      platform: "youtube",
    },
  ];
}

type SyndicationMedia = {
  type?: string;
  media_url_https?: string;
  video_info?: { variants?: { bitrate?: number; content_type: string; url: string }[] };
};

type SyndicationTweet = {
  id_str?: string;
  mediaDetails?: SyndicationMedia[];
};

async function resolveTwitter(sourceUrl: string, id: string, doFetch: typeof fetch): Promise<VideoAsset[]> {
  // the token is the web client's derivation from the tweet id; an absent token returns an empty payload
  // shortcut: X does not validate this token today and the derivation divides an id above 2^53 as a float — derive it exactly if X ever starts rejecting tokens
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`;

  const res = await doFetch(endpoint, {
    headers: { "User-Agent": CHROME_UA, Accept: "application/json" },
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
  if (!tweet.id_str) throw new Error("X returned an unexpected response. Try again later.");

  // an animated_gif is an mp4 on X too; it carries a single variant with bitrate 0
  const videos = (tweet.mediaDetails ?? []).filter((m) => m.type === "video" || m.type === "animated_gif");
  if (!videos.length) throw new Error("No video found. Only video posts are downloadable.");

  // a tweet can hold several videos: keep the best mp4 of each, in post order
  const assets: VideoAsset[] = [];
  for (const video of videos) {
    const mp4 = (video.video_info?.variants ?? [])
      .filter((v) => v.content_type === "video/mp4")
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    if (mp4) assets.push({ videoUrl: mp4.url, thumbnail: video.media_url_https, shortcode: id, sourceUrl, platform: "twitter" });
  }
  if (!assets.length) throw new Error("No downloadable video found for this post.");

  return assets;
}
