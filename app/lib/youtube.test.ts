import { describe, expect, test } from "bun:test";
import { stubFetch } from "./fake-fetch";
import { getYouTubeFormats, type TubeInfo } from "./youtube";

const info = (formats: TubeInfo["formats"], playability = "OK", reason?: string): TubeInfo => ({
  playability,
  reason,
  formats,
});

const mp4 = (url: string, height: number) => ({ url, mime_type: "video/mp4", width: 0, height });
const headOk = stubFetch(() => new Response(null, { status: 200 }));

describe("getYouTubeFormats", () => {
  test("keeps mp4 renditions best-first by height", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      getInfo: async () => info([mp4("https://x/360.mp4", 360), mp4("https://x/1080.mp4", 1080), mp4("https://x/720.mp4", 720)]),
      fetch: headOk,
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
      fetch: headOk,
    });
    expect(formats.map((f) => f.videoUrl)).toEqual(["https://x/cipher.mp4", "https://x/720.mp4"]);
  });

  test("falls back to ANDROID when the IOS urls refuse playback", async () => {
    const gated = "https://x/ios-gated.mp4";
    const open = "https://x/android-open.mp4";
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      getInfo: async (_id, client) => (client === "IOS" ? info([mp4(gated, 1080)]) : info([mp4(open, 360)])),
      fetch: stubFetch((url) => new Response(null, { status: url === gated ? 403 : 200 })),
    });
    expect(formats.map((f) => f.videoUrl)).toEqual([open]);
  });

  test("returns empty when every client is gated", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      getInfo: async () => info([mp4("https://x/gated.mp4", 1080)]),
      fetch: stubFetch(() => new Response(null, { status: 403 })),
    });
    expect(formats).toEqual([]);
  });

  test("reports an unplayable video with its reason", async () => {
    await expect(
      getYouTubeFormats("dQw4w9WgXcQ", {
        getInfo: async () => info([], "LOGIN_REQUIRED", "Sign in to confirm your age"),
        fetch: headOk,
      }),
    ).rejects.toThrow("Sign in to confirm your age");
  });

  test("reports an unreachable YouTube instead of crashing", async () => {
    const failure = new TypeError("fetch failed");
    const down = () => {
      throw failure;
    };
    const err = await getYouTubeFormats("dQw4w9WgXcQ", { getInfo: down, fetch: headOk }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch("YouTube is unreachable");
    expect((err as Error).cause).toBe(failure);
  });

  test("returns an empty list when no mp4 rendition exists", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      getInfo: async () => info([{ mime_type: "video/webm", width: 0, height: 720 }]),
      fetch: headOk,
    });
    expect(formats).toEqual([]);
  });

  test("carries the video title onto every rendition", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      getInfo: async () => ({ ...info([mp4("https://x/720.mp4", 720)]), title: "Never Gonna Give You Up" }),
      fetch: headOk,
    });
    expect(formats.map((f) => f.title)).toEqual(["Never Gonna Give You Up"]);
  });
});
