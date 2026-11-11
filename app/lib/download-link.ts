// Module: DownloadLink — the VideoAsset → download-file round trip, owned in one place.
// Interface: toDownloadHref(assets, index?, deps?) → string, fromDownloadRequest(url, deps?) → { videoUrl, stem }.
// The href carries its own expiry and an HMAC of url + name + expiry, so the
// download route needs no shared state: any instance can verify what another
// signed. Server-only (node:crypto) — the client just follows the href.

import { createHmac, timingSafeEqual } from "node:crypto";

import { FRESH_MS } from "./freshness";
import type { VideoAsset } from "./media-resolver";

export interface DownloadRequest {
  videoUrl: string;
  stem: string;
}

export interface DownloadLinkDeps {
  now?: number;
  secret?: string;
}

const secretOf = (deps: DownloadLinkDeps): string => {
  const secret = deps.secret ?? process.env.DOWNLOAD_SECRET;

  if (!secret) {
    throw new Error("DOWNLOAD_SECRET is not set");
  }

  return secret;
};

const sign = (payload: string, deps: DownloadLinkDeps): string =>
  createHmac("sha256", secretOf(deps)).update(payload).digest("base64url");

const payloadOf = (videoUrl: string, stem: string, exp: number): string =>
  `${videoUrl}\n${stem}\n${exp}`;

const reject = (): never => {
  throw new Response("Resolve the link in the form first", { status: 403 });
};

export const toDownloadHref = (
  assets: VideoAsset[],
  index = 0,
  deps: DownloadLinkDeps = {}
): string => {
  const asset = assets[index];

  if (!asset) {
    throw new Error("No video at this position");
  }

  // a lone video keeps the plain stem; siblings get a tag — position for X multi, quality for YouTube renditions
  const tag = asset.label ?? String(index + 1);

  const stem =
    assets.length > 1
      ? `${asset.platform}-${asset.shortcode}-${tag}`
      : `${asset.platform}-${asset.shortcode}`;

  const exp = (deps.now ?? Date.now()) + FRESH_MS;
  const signature = sign(payloadOf(asset.videoUrl, stem, exp), deps);

  return `/api/download?url=${encodeURIComponent(asset.videoUrl)}&name=${encodeURIComponent(stem)}&e=${exp}&s=${signature}`;
};

export const fromDownloadRequest = (
  url: string,
  deps: DownloadLinkDeps = {}
): DownloadRequest => {
  const params = new URL(url).searchParams;
  const videoUrl = params.get("url");
  const stem = params.get("name") ?? "video";
  const exp = Number(params.get("e") ?? 0);
  const signature = params.get("s");

  if (!videoUrl || !signature || !(exp > (deps.now ?? Date.now()))) {
    return reject();
  }

  const expected = sign(payloadOf(videoUrl, stem, exp), deps);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);

  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return reject();
  }

  return { stem, videoUrl };
};
