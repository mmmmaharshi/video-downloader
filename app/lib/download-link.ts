// Module: DownloadLink — the VideoAsset → download-file round trip, owned in one place.
// Interface: toDownloadHref(assets, index?) → string, fromDownloadRequest(url) → { videoUrl, stem }.
// Both routes cross this seam instead of reconstructing videoUrl + shortcode at call sites.

import type { VideoAsset } from "./media-resolver";

export function toDownloadHref(assets: VideoAsset[], index = 0): string {
  const asset = assets[index];
  if (!asset) throw new Error("No video at this position");
  // a lone video keeps the plain stem; siblings get numbered so each file lands separately
  const stem = assets.length > 1 ? `${asset.platform}-${asset.shortcode}-${index + 1}` : `${asset.platform}-${asset.shortcode}`;
  return `/api/download?url=${encodeURIComponent(asset.videoUrl)}&name=${encodeURIComponent(stem)}`;
}

export function fromDownloadRequest(url: string): { videoUrl: string | null; stem: string } {
  const params = new URL(url).searchParams;
  return { videoUrl: params.get("url"), stem: params.get("name") ?? "video" };
}
