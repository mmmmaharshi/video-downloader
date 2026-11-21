import { describe, expect, test } from "bun:test";

import { fromDownloadRequest, toDownloadHref } from "./download-link";
import { FRESH_MS } from "./freshness";
import type { VideoAsset } from "./media-resolver";

const SECRET = "test-secret";

const devDeps = { now: 0, secret: SECRET };

const asset = (
  platform: VideoAsset["platform"],
  shortcode: string,
  videoUrl: string,
  label?: string
): VideoAsset => ({
  label,
  platform,
  shortcode,
  sourceUrl: `https://example.com/${shortcode}`,
  videoUrl,
});

const thrown = (act: () => void): Response => {
  try {
    act();
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    throw new Error("expected a Response, got another error", { cause: error });
  }

  throw new Error("expected a Response, got none");
};

describe("toDownloadHref", () => {
  test("names an X download after the tweet id", () => {
    expect(
      toDownloadHref(
        [
          asset(
            "twitter",
            "2006763209378922836",
            "https://video.twimg.com/x.mp4"
          ),
        ],
        0,
        devDeps
      )
    ).toStartWith(
      "/api/download?url=https%3A%2F%2Fvideo.twimg.com%2Fx.mp4&name=twitter-2006763209378922836"
    );
  });

  test("encodes a video url that carries its own query string", () => {
    const href = toDownloadHref(
      [
        asset(
          "instagram",
          "ABC123",
          "https://scontent.cdninstagram.com/v.mp4?e=1&v=2"
        ),
      ],
      0,
      devDeps
    );

    expect(new URL(href, "https://app.example").searchParams.get("url")).toBe(
      "https://scontent.cdninstagram.com/v.mp4?e=1&v=2"
    );
  });

  test("numbers siblings so each file lands separately", () => {
    const assets = [
      asset("twitter", "99", "https://video.twimg.com/first.mp4"),
      asset("twitter", "99", "https://video.twimg.com/second.mp4"),
    ];

    const name = (index: number) =>
      new URL(
        toDownloadHref(assets, index, devDeps),
        "https://app.example"
      ).searchParams.get("name");

    expect(name(0)).toBe("twitter-99-1");
    expect(name(1)).toBe("twitter-99-2");
  });

  test("tags siblings by quality label when present", () => {
    const assets = [
      asset("youtube", "dQw4w9WgXcQ", "https://x/1080.mp4", "1080p"),
      asset("youtube", "dQw4w9WgXcQ", "https://x/720.mp4", "720p"),
    ];

    const name = (index: number) =>
      new URL(
        toDownloadHref(assets, index, devDeps),
        "https://app.example"
      ).searchParams.get("name");

    expect(name(0)).toBe("youtube-dQw4w9WgXcQ-1080p");
    expect(name(1)).toBe("youtube-dQw4w9WgXcQ-720p");
  });

  test("refuses an index past the end", () => {
    expect(() =>
      toDownloadHref(
        [asset("twitter", "99", "https://video.twimg.com/x.mp4")],
        1,
        devDeps
      )
    ).toThrow("No video at this position");
  });

  test("refuses to sign without a secret", () => {
    expect(() =>
      toDownloadHref(
        [asset("twitter", "99", "https://video.twimg.com/x.mp4")],
        0,
        { now: 0, secret: "" }
      )
    ).toThrow("DOWNLOAD_SECRET");
  });
});

describe("fromDownloadRequest", () => {
  test("round-trips what toDownloadHref built", () => {
    const a = asset(
      "twitter",
      "2006763209378922836",
      "https://video.twimg.com/x.mp4"
    );

    const href = toDownloadHref([a], 0, devDeps);

    expect(
      fromDownloadRequest(`https://app.example${href}`, {
        now: FRESH_MS - 1,
        secret: SECRET,
      })
    ).toEqual({
      stem: "twitter-2006763209378922836",
      videoUrl: "https://video.twimg.com/x.mp4",
    });
  });

  test("answers 403 for an expired link", () => {
    const href = toDownloadHref(
      [asset("twitter", "99", "https://video.twimg.com/x.mp4")],
      0,
      devDeps
    );

    const res = thrown(() =>
      fromDownloadRequest(`https://app.example${href}`, {
        now: FRESH_MS,
        secret: SECRET,
      })
    );

    expect(res.status).toBe(403);
  });

  test("answers 403 when the url is altered after signing", () => {
    const href = toDownloadHref(
      [asset("twitter", "99", "https://video.twimg.com/x.mp4")],
      0,
      devDeps
    );

    const tampered = href.replace(
      encodeURIComponent("https://video.twimg.com/x.mp4"),
      encodeURIComponent("http://169.254.169.254/latest/meta-data/")
    );

    const res = thrown(() =>
      fromDownloadRequest(`https://app.example${tampered}`, {
        now: 1,
        secret: SECRET,
      })
    );

    expect(res.status).toBe(403);
  });

  test("answers 403 when the name is altered after signing", () => {
    const href = toDownloadHref(
      [asset("twitter", "99", "https://video.twimg.com/x.mp4")],
      0,
      devDeps
    );

    const tampered = href.replace("name=twitter-99", "name=twitter-66");

    const res = thrown(() =>
      fromDownloadRequest(`https://app.example${tampered}`, {
        now: 1,
        secret: SECRET,
      })
    );

    expect(res.status).toBe(403);
  });

  test("answers 403 for a link signed with another secret", () => {
    const href = toDownloadHref(
      [asset("twitter", "99", "https://video.twimg.com/x.mp4")],
      0,
      devDeps
    );

    const res = thrown(() =>
      fromDownloadRequest(`https://app.example${href}`, {
        now: 1,
        secret: "other-secret",
      })
    );

    expect(res.status).toBe(403);
  });

  test("answers 403 for a hand-written link with no signature", () => {
    const res = thrown(() =>
      fromDownloadRequest(
        "https://app.example/api/download?url=https%3A%2F%2Fx.mp4&name=x",
        { now: 1, secret: SECRET }
      )
    );

    expect(res.status).toBe(403);
  });
});
