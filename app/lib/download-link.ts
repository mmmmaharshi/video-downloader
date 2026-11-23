// Module: DownloadLink — the VideoAsset → download-file round trip, owned in one place.
// Interface: toDownloadHref(assets, index?, deps?) → string, fromDownloadRequest(url, deps?) → { videoUrl, stem }.
// The href carries its own expiry and an HMAC of url + name + expiry, so the
// download route needs no shared state: any instance can verify what another
// signed. Server-only (node:crypto) — the client just follows the href.

import { createHmac, timingSafeEqual } from "node:crypto";

import { FRESH_MS } from "./freshness";
import type { VideoAsset } from "./resolve-query";
import { API_DOWNLOAD } from "./routes";
import { stemOf } from "./stem";

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

// Length-prefixed fields keep the MAC unambiguous even when a signed URL contains a newline.
const payloadOf = (videoUrl: string, stem: string, exp: number): string =>
  [videoUrl, stem, String(exp)]
    .map((value) => `${value.length}:${value}`)
    .join("");

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

  const stem = stemOf(assets, index);

  const exp = (deps.now ?? Date.now()) + FRESH_MS;
  const signature = sign(payloadOf(asset.videoUrl, stem, exp), deps);

  return `${API_DOWNLOAD}?url=${encodeURIComponent(asset.videoUrl)}&name=${encodeURIComponent(stem)}&e=${exp}&s=${signature}`;
};

export const fromDownloadRequest = (
  url: string,
  deps: DownloadLinkDeps = {}
): DownloadRequest => {
  const params = new URL(url).searchParams;
  const videoUrl = params.get("url");
  const stem = params.get("name");
  const exp = Number(params.get("e") ?? 0);
  const signature = params.get("s");

  if (!videoUrl || !stem || !signature || !(exp > (deps.now ?? Date.now()))) {
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
