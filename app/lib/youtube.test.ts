import { describe, expect, test } from "bun:test";

import { stubFetch } from "./fake-fetch";
import { getYouTubeFormats } from "./youtube";
import type { TubeInfo } from "./youtube";

const info = (
  formats: TubeInfo["formats"],
  playability = "OK",
  reason?: string
): TubeInfo => ({
  formats,
  playability,
  reason,
});

const mp4 = (url: string, height: number) => ({
  height,
  mime_type: "video/mp4",
  url,
  width: 0,
});
const headOk = stubFetch(() => new Response(null, { status: 200 }));

describe("getYouTubeFormats", () => {
  test("keeps mp4 renditions best-first by height", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: headOk,
      getInfo: () =>
        info([
          mp4("https://x/360.mp4", 360),
          mp4("https://x/1080.mp4", 1080),
          mp4("https://x/720.mp4", 720),
        ]),
    });
    expect(formats.map((f) => f.videoUrl)).toEqual([
      "https://x/1080.mp4",
      "https://x/720.mp4",
      "https://x/360.mp4",
    ]);
  });

  test("drops non-mp4 and url-less formats", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: headOk,
      getInfo: () =>
        info([
          { height: 1080, mime_type: "video/webm", width: 0 },
          {
            height: 720,
            mime_type: "video/mp4",
            url: "https://x/720.mp4",
            width: 0,
          },
          {
            height: 1080,
            mime_type: "video/mp4; codecs=1",
            url: "https://x/cipher.mp4",
            width: 0,
          },
        ]),
    });
    expect(formats.map((f) => f.videoUrl)).toEqual([
      "https://x/cipher.mp4",
      "https://x/720.mp4",
    ]);
  });

  test("falls back to ANDROID when the IOS urls refuse playback", async () => {
    const gated = "https://x/ios-gated.mp4";
    const open = "https://x/android-open.mp4";
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: stubFetch(
        (url) => new Response(null, { status: url === gated ? 403 : 200 })
      ),
      getInfo: (_id, client) =>
        client === "IOS" ? info([mp4(gated, 1080)]) : info([mp4(open, 360)]),
    });
    expect(formats.map((f) => f.videoUrl)).toEqual([open]);
  });

  test("returns empty when every client is gated", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: stubFetch(() => new Response(null, { status: 403 })),
      getInfo: () => info([mp4("https://x/gated.mp4", 1080)]),
    });
    expect(formats).toEqual([]);
  });

  test("reports an unplayable video with its reason", async () => {
    await expect(
      getYouTubeFormats("dQw4w9WgXcQ", {
        fetch: headOk,
        getInfo: () =>
          info([], "LOGIN_REQUIRED", "Sign in to confirm your age"),
      })
    ).rejects.toThrow("Sign in to confirm your age");
  });

  test("reports an unreachable YouTube instead of crashing", async () => {
    const failure = new TypeError("fetch failed");
    const down = () => {
      throw failure;
    };
    const err = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: headOk,
      getInfo: down,
    }).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch("YouTube is unreachable");
    expect((err as Error).cause).toBe(failure);
  });

  test("returns an empty list when no mp4 rendition exists", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: headOk,
      getInfo: () => info([{ height: 720, mime_type: "video/webm", width: 0 }]),
    });
    expect(formats).toEqual([]);
  });

  test("carries the video title onto every rendition", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: headOk,
      getInfo: () => ({
        ...info([mp4("https://x/720.mp4", 720)]),
        title: "Never Gonna Give You Up",
      }),
    });
    expect(formats.map((f) => f.title)).toEqual(["Never Gonna Give You Up"]);
  });
});
