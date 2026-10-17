import { describe, expect, test } from "bun:test";

import { stubFetch } from "./fake-fetch";
import { proxy } from "./transfer";

const CDN = "https://scontent.cdninstagram.com/v/abc.mp4";

const ok = (body = "video-bytes", contentType = "video/mp4") =>
  stubFetch(
    () =>
      new Response(body, {
        headers: { "content-type": contentType },
        status: 200,
      })
  );

const thrown = async (p: Promise<unknown>): Promise<Response> => {
  let rejection: unknown;

  await p.catch((error) => {
    rejection = error;
  });

  if (rejection instanceof Response) {
    return rejection;
  }

  throw new Error(`expected a Response, got ${String(rejection)}`);
};

describe("proxy", () => {
  test("streams the upstream body as an mp4 attachment", async () => {
    const res = await proxy(CDN, "instagram-ABC123", { fetch: ok() });
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="instagram-ABC123.mp4"'
    );
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(await res.text()).toBe("video-bytes");
  });

  test("names an X download after the tweet", async () => {
    const twimg =
      "https://video.twimg.com/amplify_video/1/vid/avc1/480x270/x.mp4";

    const res = await proxy(twimg, "twitter-2006763209378922836", {
      fetch: ok(),
    });

    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="twitter-2006763209378922836.mp4"'
    );
  });

  test("strips header-breaking characters out of the download name", async () => {
    const res = await proxy(CDN, 'a"b;c d', { fetch: ok() });
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="a_b_c_d.mp4"'
    );
  });

  test("passes the upstream size through for progress display", async () => {
    const sized = stubFetch(
      () =>
        new Response("video-bytes", {
          headers: { "content-length": "11", "content-type": "video/mp4" },
          status: 200,
        })
    );

    const res = await proxy(CDN, "ABC123", { fetch: sized });
    expect(res.headers.get("content-length")).toBe("11");
  });

  test("leaves content-length absent when the upstream sends none", async () => {
    const res = await proxy(CDN, "ABC123", { fetch: ok() });
    expect(res.headers.get("content-length")).toBeNull();
  });

  test("aborts a stalled upstream past the total bound", async () => {
    const hanging = Object.assign(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        // the stub must stay pending until the abort fires — no awaitable built-in expresses that
        // eslint-disable-next-line promise/avoid-new
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        }),
      // the global fetch's real preconnect, unused by this stub
      { preconnect: fetch.preconnect }
    );

    const res = await thrown(
      proxy(CDN, "ABC123", { fetch: hanging, maxMs: 50 })
    );

    expect(res.status).toBe(502);
  });

  test("rewrites an m3u8 playlist's relative segment refs absolute", async () => {
    const playlist = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "seg-1.ts",
      "",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      "../seg/seg-2.ts?token=abc",
      "https://cdn.example/seg-3.ts",
    ].join("\n");

    const res = await proxy("https://cdn.example/hls/master.m3u8?x=1", "abc", {
      fetch: ok(playlist, "application/vnd.apple.mpegurl"),
    });

    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="abc.m3u8"'
    );
    expect(await res.text()).toBe(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "https://cdn.example/hls/seg-1.ts",
        "",
        '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/hls/key.bin"',
        "https://cdn.example/seg/seg-2.ts?token=abc",
        "https://cdn.example/seg-3.ts",
      ].join("\n")
    );
  });

  test("falls back to video/mp4 when upstream sends no content type", async () => {
    const res = await proxy(CDN, "ABC123", {
      fetch: stubFetch(() => new Response("x", { status: 200 })),
    });

    expect(res.headers.get("content-type")).toBe("video/mp4");
  });

  test.each([
    // [url, upstream content-type, expected extension]
    ["https://x/video.m3u8", "application/vnd.apple.mpegurl", "m3u8"],
    ["https://x/playlist", "application/x-mpegURL", "m3u8"],
    ["https://x/manifest.mpd", "application/dash+xml", "mpd"],
    ["https://x/clip", "video/webm", "webm"],
    ["https://x/clip", "video/quicktime", "mov"],
    ["https://x/clip", "video/mp4", "mp4"],
  ])(
    "names the %s (%s) download with a .%s extension",
    async (url, contentType, ext) => {
      const res = await proxy(url, "reddit-abc123", {
        fetch: ok("bytes", contentType),
      });

      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="reddit-abc123.${ext}"`
      );
    }
  );

  test("rejects a missing url with 400", async () => {
    const res = await thrown(proxy("", "ABC123", { fetch: ok() }));
    expect(res.status).toBe(400);
  });

  test("proxies an arbitrary remembered url — access control is the caller's gate", async () => {
    const res = await proxy("https://cdn.example.com/clips/a.mp4", "direct-a", {
      fetch: ok(),
    });

    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="direct-a.mp4"'
    );
  });

  test("maps an upstream error status to 502", async () => {
    const failing = stubFetch(() => new Response("nope", { status: 500 }));
    const res = await thrown(proxy(CDN, "ABC123", { fetch: failing }));
    expect(res.status).toBe(502);
  });

  test("maps a bodiless upstream response to 502", async () => {
    const bodiless = stubFetch(() => new Response(null, { status: 200 }));
    const res = await thrown(proxy(CDN, "ABC123", { fetch: bodiless }));
    expect(res.status).toBe(502);
  });

  test("maps an unreachable upstream to 502", async () => {
    const unreachable = stubFetch(() => {
      throw new TypeError("fetch failed");
    });

    const res = await thrown(proxy(CDN, "ABC123", { fetch: unreachable }));
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Upstream unreachable");
  });
});
