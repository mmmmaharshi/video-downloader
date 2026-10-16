import { describe, expect, test } from "bun:test";
import { fromDownloadRequest, toDownloadHref } from "./download-link";
import type { VideoAsset } from "./media-resolver";

const asset = (platform: VideoAsset["platform"], shortcode: string, videoUrl: string): VideoAsset => ({
  videoUrl,
  shortcode,
  sourceUrl: `https://example.com/${shortcode}`,
  platform,
});

describe("toDownloadHref", () => {
  test("names an X download after the tweet id", () => {
    expect(toDownloadHref(asset("twitter", "2006763209378922836", "https://video.twimg.com/x.mp4"))).toBe(
      "/api/download?url=https%3A%2F%2Fvideo.twimg.com%2Fx.mp4&name=twitter-2006763209378922836",
    );
  });

  test("names an Instagram download after the shortcode", () => {
    expect(toDownloadHref(asset("instagram", "ABC123", "https://scontent.cdninstagram.com/v.mp4"))).toBe(
      "/api/download?url=https%3A%2F%2Fscontent.cdninstagram.com%2Fv.mp4&name=instagram-ABC123",
    );
  });

  test("encodes a video url that carries its own query string", () => {
    const href = toDownloadHref(asset("instagram", "ABC123", "https://scontent.cdninstagram.com/v.mp4?e=1&v=2"));
    expect(new URL(href, "https://app.example").searchParams.get("url")).toBe("https://scontent.cdninstagram.com/v.mp4?e=1&v=2");
  });
});

describe("fromDownloadRequest", () => {
  test("round-trips what toDownloadHref built", () => {
    const a = asset("twitter", "2006763209378922836", "https://video.twimg.com/x.mp4");
    expect(fromDownloadRequest(`https://app.example${toDownloadHref(a)}`)).toEqual({
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
