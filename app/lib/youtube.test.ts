import { describe, expect, test } from "bun:test";
import { getYouTubeFormats, type TubeInfo } from "./youtube";

const info = (formats: TubeInfo["formats"], playability = "OK", reason?: string): TubeInfo => ({
  playability,
  reason,
  formats,
});

const mp4 = (url: string, height: number) => ({ url, mime_type: "video/mp4", width: 0, height });

describe("getYouTubeFormats", () => {
  test("keeps mp4 renditions best-first by height", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      getInfo: async () => info([mp4("https://x/360.mp4", 360), mp4("https://x/1080.mp4", 1080), mp4("https://x/720.mp4", 720)]),
    });
    expect(formats.map((f) => f.videoUrl)).toEqual(["https://x/1080.mp4", "https://x/720.mp4", "https://x/360.mp4"]);
  });

  test("drops non-mp4 and url-less formats", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      getInfo: async () =>
        info([
          { mime_type: "video/webm", width: 0, height: 1080 },
          { url: "https://x/720.mp4", mime_type: "video/mp4", width: 0, height: 720 },
          { url: "https://x/cipher.mp4", mime_type: "video/mp4; codecs=1", width: 0, height: 1080 },
        ]),
    });
    expect(formats.map((f) => f.videoUrl)).toEqual(["https://x/cipher.mp4", "https://x/720.mp4"]);
  });

  test("reports an unplayable video with its reason", async () => {
    await expect(
      getYouTubeFormats("dQw4w9WgXcQ", { getInfo: async () => info([], "LOGIN_REQUIRED", "Sign in to confirm your age") }),
    ).rejects.toThrow("Sign in to confirm your age");
  });

  test("reports an unreachable YouTube instead of crashing", async () => {
    const down = () => {
      throw new TypeError("fetch failed");
    };
    await expect(getYouTubeFormats("dQw4w9WgXcQ", { getInfo: down })).rejects.toThrow("YouTube is unreachable");
  });

  test("returns an empty list when no mp4 rendition exists", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      getInfo: async () => info([{ mime_type: "video/webm", width: 0, height: 720 }]),
    });
    expect(formats).toEqual([]);
  });
});
