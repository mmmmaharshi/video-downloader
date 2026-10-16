// Module: DownloadLink — the VideoAsset → download-file round trip, owned in one place.
// Interface: toDownloadHref(asset) → string, fromDownloadRequest(url) → { videoUrl, stem }.
// Both routes cross this seam instead of reconstructing videoUrl + shortcode at call sites.

import type { VideoAsset } from "./media-resolver";

export function toDownloadHref(asset: VideoAsset): string {
  const stem = `${asset.platform}-${asset.shortcode}`;
  return `/api/download?url=${encodeURIComponent(asset.videoUrl)}&name=${encodeURIComponent(stem)}`;
}

export function fromDownloadRequest(url: string): { videoUrl: string | null; stem: string } {
  const params = new URL(url).searchParams;
  return { videoUrl: params.get("url"), stem: params.get("name") ?? "video" };
}
