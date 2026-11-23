import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import type { TubeInfo } from "./youtube";
import {
  getYouTubeFormatsProgram,
  youtubeErrorMessage,
  YouTubeInfo,
} from "./youtube-effect";

const info = (
  formats: TubeInfo["formats"],
  playability = "OK",
  reason?: string
): TubeInfo => ({
  formats,
  playability,
  reason,
});

const mp4 = (url: string, height: number, muxed?: boolean) => ({
  height,
  mime_type: "video/mp4",
  muxed,
  url,
  width: 0,
});

const headOkFetch = stubFetch(() => new Response(null, { status: 200 }));

const publicHost = () => ["93.184.216.34"];

const layers = (
  getInfo: (id: string, client: "IOS" | "ANDROID") => TubeInfo,
  doFetch: typeof headOkFetch = headOkFetch,
  lookup: () => string[] = publicHost
) =>
  Layer.merge(
    Layer.succeed(FetchDeps)({ doFetch, lookup }),
    Layer.succeed(YouTubeInfo)({ getInfo })
  );

const runFormats = (id: string, layer: Layer.Layer<FetchDeps | YouTubeInfo>) =>
  Effect.runPromise(Effect.provide(getYouTubeFormatsProgram(id), layer));

const runFormatsError = (
  id: string,
  layer: Layer.Layer<FetchDeps | YouTubeInfo>
) =>
  Effect.runPromise(
    Effect.flip(Effect.provide(getYouTubeFormatsProgram(id), layer))
  );

describe("youtube-effect", () => {
  test("keeps mp4 renditions best-first through layers", async () => {
    const formats = await runFormats(
      "dQw4w9WgXcQ",
      layers(() =>
        info([
          mp4("https://x/360.mp4", 360),
          mp4("https://x/1080.mp4", 1080),
          mp4("https://x/720.mp4", 720),
        ])
      )
    );

    expect(formats.map((f) => f.videoUrl)).toEqual([
      "https://x/1080.mp4",
      "https://x/720.mp4",
      "https://x/360.mp4",
    ]);
  });

  test("falls back to ANDROID when the IOS urls refuse playback", async () => {
    const gated = "https://x/ios-gated.mp4";
    const open = "https://x/android-open.mp4";

    const formats = await runFormats(
      "dQw4w9WgXcQ",
      layers(
        (_id, client) =>
          client === "IOS" ? info([mp4(gated, 1080)]) : info([mp4(open, 360)]),
        stubFetch((_url, init) => {
          const host = new Headers(init?.headers).get("host");

          return new Response(null, {
            status: host === "x" && _url.includes("ios-gated") ? 403 : 200,
          });
        })
      )
    );

    expect(formats.map((f) => f.videoUrl)).toEqual([open]);
  });

  test("probes past a gated best rung instead of abandoning the client", async () => {
    const calls: string[] = [];
    const gated = "https://x/gated-1080.mp4";
    const open = "https://x/open-360.mp4";

    const formats = await runFormats(
      "dQw4w9WgXcQ",
      layers(
        (_id, client) => {
          calls.push(client);

          return info([mp4(gated, 1080), mp4(open, 360)]);
        },
        stubFetch((_url) => {
          const gatedHead = _url.includes("gated");

          return new Response(null, { status: gatedHead ? 403 : 200 });
        })
      )
    );

    expect(formats.map((f) => f.videoUrl)).toEqual([gated, open]);
    // both clients are asked: neither offered a muxed rung, so the video-only
    // fallback is only used after the search for sound came up empty
    expect(calls).toEqual(["IOS", "ANDROID"]);
  });

  test("runs one more sweep when the first answers nothing playable", async () => {
    let calls = 0;

    const formats = await runFormats(
      "dQw4w9WgXcQ",
      layers(() => {
        calls += 1;

        return calls <= 2 ? info([]) : info([mp4("https://x/720.mp4", 720)]);
      })
    );

    expect(formats.map((f) => f.videoUrl)).toEqual(["https://x/720.mp4"]);
    // sweep one asks both clients (2 calls), sweep two asks both again (4):
    // a rung with no audio never ends the search early
    expect(calls).toBe(4);
  });

  test("prefers a muxed stream so the download has sound", async () => {
    // the real payload for a video like this: IOS lists only adaptive (video
    // only) rungs, ANDROID lists a progressive one
    const silent = "https://x/adaptive-1080.mp4";
    const sound = "https://x/progressive-360.mp4";

    const formats = await runFormats(
      "dQw4w9WgXcQ",
      layers((_id, client) =>
        client === "IOS"
          ? info([mp4(silent, 1080, false)])
          : info([
              mp4(sound, 360, true),
              mp4("https://x/adaptive-720.mp4", 720, false),
            ])
      )
    );

    expect(formats.map((f) => f.videoUrl)).toEqual([sound]);
  });

  test("reports an unplayable video with its reason", async () => {
    const error = await runFormatsError(
      "dQw4w9WgXcQ",
      layers(() => info([], "LOGIN_REQUIRED", "Sign in to confirm your age"))
    );

    expect(error._tag).toBe("YouTubeUnavailable");
    expect(youtubeErrorMessage(error)).toContain("Sign in to confirm your age");
  });

  test("reports unreachable YouTube instead of crashing", async () => {
    const error = await runFormatsError(
      "dQw4w9WgXcQ",
      layers(() => {
        throw new TypeError("fetch failed");
      })
    );

    expect(error._tag).toBe("YouTubeUnreachable");
    expect(youtubeErrorMessage(error)).toBe(
      "YouTube is unreachable right now. Try again later."
    );
  });

  test("refuses to send a HEAD request to a private format host", async () => {
    const fetched: string[] = [];

    const record = stubFetch((url) => {
      fetched.push(url);

      return new Response(null, { status: 200 });
    });

    const formats = await runFormats(
      "dQw4w9WgXcQ",
      layers(
        () => info([mp4("http://169.254.169.254/latest/meta-data/", 1080)]),
        record,
        () => ["169.254.169.254"]
      )
    );

    expect(formats).toEqual([]);
    expect(fetched).toEqual([]);
  });

  test("every tag maps to its legacy message", async () => {
    const unavailable = await runFormatsError(
      "dQw4w9WgXcQ",
      layers(() => info([], "LOGIN_REQUIRED", "Sign in to confirm your age"))
    );

    expect(youtubeErrorMessage(unavailable)).toBe(
      "This video is unavailable: Sign in to confirm your age. Private or age-restricted videos need a login, which is not supported."
    );
  });
});
