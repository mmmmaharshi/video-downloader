import { describe, expect, test } from "bun:test";
import { fromDownloadRequest, toDownloadHref } from "./download-link";
import type { VideoAsset } from "./media-resolver";

const asset = (platform: VideoAsset["platform"], shortcode: string, videoUrl: string, label?: string): VideoAsset => ({
  videoUrl,
  shortcode,
  sourceUrl: `https://example.com/${shortcode}`,
  platform,
  ...(label ? { label } : {}),
});

describe("toDownloadHref", () => {
  test("names an X download after the tweet id", () => {
    expect(toDownloadHref([asset("twitter", "2006763209378922836", "https://video.twimg.com/x.mp4")])).toBe(
      "/api/download?url=https%3A%2F%2Fvideo.twimg.com%2Fx.mp4&name=twitter-2006763209378922836",
    );
  });

  test("names an Instagram download after the shortcode", () => {
    expect(toDownloadHref([asset("instagram", "ABC123", "https://scontent.cdninstagram.com/v.mp4")])).toBe(
      "/api/download?url=https%3A%2F%2Fscontent.cdninstagram.com%2Fv.mp4&name=instagram-ABC123",
    );
  });

  test("encodes a video url that carries its own query string", () => {
    const href = toDownloadHref([asset("instagram", "ABC123", "https://scontent.cdninstagram.com/v.mp4?e=1&v=2")]);
    expect(new URL(href, "https://app.example").searchParams.get("url")).toBe("https://scontent.cdninstagram.com/v.mp4?e=1&v=2");
  });

  test("numbers siblings so each file lands separately", () => {
    const assets = [
      asset("twitter", "99", "https://video.twimg.com/first.mp4"),
      asset("twitter", "99", "https://video.twimg.com/second.mp4"),
    ];
    expect(new URL(toDownloadHref(assets, 0), "https://app.example").searchParams.get("name")).toBe("twitter-99-1");
    expect(new URL(toDownloadHref(assets, 1), "https://app.example").searchParams.get("name")).toBe("twitter-99-2");
  });

  test("tags siblings by quality label when present", () => {
    const assets = [
      asset("youtube", "dQw4w9WgXcQ", "https://x/1080.mp4", "1080p"),
      asset("youtube", "dQw4w9WgXcQ", "https://x/720.mp4", "720p"),
    ];
    expect(new URL(toDownloadHref(assets, 0), "https://app.example").searchParams.get("name")).toBe(
      "youtube-dQw4w9WgXcQ-1080p",
    );
    expect(new URL(toDownloadHref(assets, 1), "https://app.example").searchParams.get("name")).toBe(
      "youtube-dQw4w9WgXcQ-720p",
    );
  });
  test("refuses an index past the end", () => {
    expect(() => toDownloadHref([asset("twitter", "99", "https://video.twimg.com/x.mp4")], 1)).toThrow("No video at this position");
  });
});

describe("fromDownloadRequest", () => {
  test("round-trips what toDownloadHref built", () => {
    const a = asset("twitter", "2006763209378922836", "https://video.twimg.com/x.mp4");
    expect(fromDownloadRequest(`https://app.example${toDownloadHref([a])}`)).toEqual({
      videoUrl: "https://video.twimg.com/x.mp4",
      stem: "twitter-2006763209378922836",
    });
  });

  test("defaults the stem when the name param is absent", () => {
    expect(fromDownloadRequest("https://app.example/api/download?url=https%3A%2F%2Fx.mp4")).toEqual({
      videoUrl: "https://x.mp4",
      stem: "video",
    });
  });

  test("reports a missing url so the proxy can answer 400", () => {
    expect(fromDownloadRequest("https://app.example/api/download?name=x")).toEqual({ videoUrl: null, stem: "x" });
  });
});
