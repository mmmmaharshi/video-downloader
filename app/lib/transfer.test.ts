import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { proxy as proxyRaw } from "./transfer";
import type { TransferDeps } from "./transfer";

// deterministic DNS: every proxy call runs the public-host guard
const publicHost = () => ["93.184.216.34"];

const proxy = (videoUrl: string, stem: string, deps: TransferDeps = {}) =>
  proxyRaw(videoUrl, stem, { lookup: publicHost, ...deps });

const CDN = "https://scontent.cdninstagram.com/v/abc.mp4";

const ok = (body = "video-bytes", contentType = "video/mp4") =>
  stubFetch(
    () =>
      new Response(body, {
        headers: { "content-type": contentType },
        status: 200,
      })
  );

// A capped stream fails by erroring mid-body; drain it the way a player would.
const drain = async (res: Response) => {
  const reader = res.body?.getReader();

  if (!reader) {
    throw new Error("expected a response body");
  }

  let received = 0;
  let failure: unknown;
  let done = false;

  try {
    while (!done) {
      // eslint-disable-next-line no-await-in-loop -- draining the bounded stream one chunk at a time
      const { done: finished, value } = await reader.read();

      done = finished;

      if (value) {
        received += value.byteLength;
      }
    }
  } catch (error) {
    failure = error;
  }

  return { failure, received };
};

const overCapBody = () => {
  const chunk = new TextEncoder().encode("0123456789");

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.close();
    },
  });
};

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

  test("rewrites a DASH manifest's relative refs absolute", async () => {
    const mpd = [
      '<MPD mediaPresentationDuration="PT10S">',
      "  <BaseURL>../video/</BaseURL>",
      '  <SegmentTemplate initialization="init-$RepresentationID$.m4s" media="seg-$Number$.m4s" indexRange="100-200" />',
      "</MPD>",
    ].join("\n");

    const res = await proxy("https://cdn.example/dash/stream.mpd", "dm-abc", {
      fetch: ok(mpd, "application/dash+xml"),
    });

    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="dm-abc.mpd"'
    );
    expect(await res.text()).toBe(
      [
        '<MPD mediaPresentationDuration="PT10S">',
        "  <BaseURL>https://cdn.example/video/</BaseURL>",
        '  <SegmentTemplate initialization="https://cdn.example/dash/init-$RepresentationID$.m4s" media="https://cdn.example/dash/seg-$Number$.m4s" indexRange="100-200" />',
        "</MPD>",
      ].join("\n")
    );
  });

  test("falls back to video/mp4 when upstream sends no content type", async () => {
    // undici defaults a string body to text/plain; the upstream under test
    // sends none, so strip what the constructor added
    const upstream = new Response("x", { status: 200 });
    upstream.headers.delete("content-type");

    const res = await proxy(CDN, "ABC123", {
      fetch: stubFetch(() => upstream),
    });

    expect(res.headers.get("content-type")).toBe("video/mp4");
  });

  test.each([
    ["https://x/clip", "video/webm", "webm"],
    ["https://x/clip", "video/quicktime", "mov"],
    ["https://x/clip", "video/mp4", "mp4"],
    ["https://x/funny", "image/gif", "gif"],
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

  test("refuses a url that resolves to a private address", async () => {
    const res = await thrown(
      proxy(CDN, "ABC123", {
        fetch: ok(),
        lookup: () => ["127.0.0.1"],
      })
    );

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Only public links are supported");
  });

  test("refuses a file larger than one download's worth", async () => {
    const huge = stubFetch(
      () =>
        new Response("video-bytes", {
          headers: {
            "content-length": String(2 * 1024 ** 3),
            "content-type": "video/mp4",
          },
          status: 200,
        })
    );

    const res = await thrown(proxy(CDN, "ABC123", { fetch: huge }));
    expect(res.status).toBe(413);
  });

  test("forwards a range request and passes the partial answer through", async () => {
    let seenRange: string | null = null;

    const ranged = stubFetch((_url, init) => {
      seenRange =
        init instanceof Request
          ? init.headers.get("range")
          : new Headers(init?.headers).get("range");

      return new Response("middle-bytes", {
        headers: {
          "accept-ranges": "bytes",
          "content-length": "12",
          "content-range": "bytes 100-111/500",
          "content-type": "video/mp4",
        },
        status: 206,
      });
    });

    const res = await proxy(CDN, "ABC123", {
      fetch: ranged,
      lookup: publicHost,
      range: "bytes=100-111",
    });

    expect(seenRange ?? "").toBe("bytes=100-111");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-111/500");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.text()).toBe("middle-bytes");
  });

  test("falls back to the full file when the upstream ignores the range", async () => {
    const res = await proxy(CDN, "ABC123", {
      fetch: ok(),
      lookup: publicHost,
      range: "bytes=100-111",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="ABC123.mp4"'
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

  test("pins the proxy connection to the approved address", async () => {
    let dialed = "";
    let host = "";

    const res = await proxy(CDN, "ABC123", {
      fetch: stubFetch((url, init) => {
        dialed = url;
        host = new Headers(init?.headers).get("host") ?? "";

        return new Response("video-bytes", {
          headers: { "content-type": "video/mp4" },
          status: 200,
        });
      }),
    });

    expect(new URL(dialed).hostname).toBe("93.184.216.34");
    expect(host).toBe("scontent.cdninstagram.com");
    expect(await res.text()).toBe("video-bytes");
  });

  test("refuses a link with no usable address", async () => {
    const res = await thrown(
      proxy(CDN, "ABC123", { fetch: ok(), lookup: () => [] })
    );

    expect(res.status).toBe(403);
  });

  test("stops a chunked body that passes the byte cap", async () => {
    const chunked = stubFetch(
      () =>
        new Response(overCapBody(), {
          headers: { "content-type": "video/mp4" },
          status: 200,
        })
    );

    const res = await proxy(CDN, "ABC123", { fetch: chunked, maxBytes: 10 });
    const { failure, received } = await drain(res);

    expect(failure).toBeInstanceOf(Response);

    if (failure instanceof Response) {
      expect(failure.status).toBe(413);
    }

    expect(received).toBeLessThanOrEqual(10);
  });

  test("stops a chunked 206 response that passes the byte cap", async () => {
    const ranged = stubFetch(
      () =>
        new Response(overCapBody(), {
          headers: {
            "accept-ranges": "bytes",
            "content-range": "bytes 0-19/100",
            "content-type": "video/mp4",
          },
          status: 206,
        })
    );

    const res = await proxy(CDN, "ABC123", {
      fetch: ranged,
      maxBytes: 10,
      range: "bytes=0-19",
    });

    const { failure, received } = await drain(res);

    expect(res.status).toBe(206);
    expect(failure).toBeInstanceOf(Response);

    if (failure instanceof Response) {
      expect(failure.status).toBe(413);
    }

    expect(received).toBeLessThanOrEqual(10);
  });

  test("refuses a buffered manifest past the byte cap", async () => {
    const huge = `#EXTM3U\n${"x".repeat(100)}`;

    const res = await thrown(
      proxy("https://cdn.example/x.m3u8", "abc", {
        fetch: ok(huge, "application/vnd.apple.mpegurl"),
        maxBytes: 10,
      })
    );

    expect(res.status).toBe(413);
  });
});
