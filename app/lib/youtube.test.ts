import { describe, expect, test } from "vitest";

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

// deterministic DNS: no test below touches the real resolver
const publicHost = () => ["93.184.216.34"];

describe("getYouTubeFormats", () => {
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
      lookup: publicHost,
    });

    expect(formats.map((f) => f.videoUrl)).toEqual([
      "https://x/cipher.mp4",
      "https://x/720.mp4",
    ]);
  });

  test("returns empty when every client is gated", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: stubFetch(() => new Response(null, { status: 403 })),
      getInfo: () => info([mp4("https://x/gated.mp4", 1080)]),
      lookup: publicHost,
    });

    expect(formats).toEqual([]);
  });

  test("reports an unreachable YouTube instead of crashing", async () => {
    const failure = new TypeError("fetch failed");

    const down = () => {
      throw failure;
    };

    const err = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: headOk,
      getInfo: down,
      lookup: publicHost,
    }).catch((error) => error);

    if (!(err instanceof Error)) {
      throw new TypeError(`expected an Error, got ${String(err)}`);
    }

    expect(err.message).toMatch("YouTube is unreachable");
    expect(err.cause).toBe(failure);
  });

  test("returns an empty list when no mp4 rendition exists", async () => {
    const formats = await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: headOk,
      getInfo: () => info([{ height: 720, mime_type: "video/webm", width: 0 }]),
      lookup: publicHost,
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
      lookup: publicHost,
    });

    expect(formats.map((f) => f.title)).toEqual(["Never Gonna Give You Up"]);
  });

  test("refuses a redirect from a public format host to a private host", async () => {
    const publicUrl = "https://cdn.example.com/video.mp4";
    const privateUrl = "http://169.254.169.254/latest/meta-data/";
    const fetched: string[] = [];

    const redirect = stubFetch((url) => {
      fetched.push(url);

      return url === publicUrl
        ? new Response(null, {
            headers: { location: privateUrl },
            status: 302,
          })
        : new Response(null, { status: 200 });
    });

    await getYouTubeFormats("dQw4w9WgXcQ", {
      fetch: redirect,
      getInfo: () => info([mp4(publicUrl, 1080)]),
      lookup: (hostname) =>
        hostname === "cdn.example.com"
          ? ["93.184.216.34"]
          : ["169.254.169.254"],
    });

    expect(fetched).not.toContain(privateUrl);
  });
});
