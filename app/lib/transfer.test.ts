import { describe, expect, test } from "bun:test";

import { stubFetch } from "./fake-fetch";
import { proxy } from "./transfer";

const CDN = "https://scontent.cdninstagram.com/v/abc.mp4";

function ok(body = "video-bytes", contentType = "video/mp4") {
  return stubFetch(
    () =>
      new Response(body, {
        headers: { "content-type": contentType },
        status: 200,
      })
  );
}

async function thrown(p: Promise<unknown>): Promise<Response> {
  const e = await p.catch((error: unknown) => error);
  expect(e).toBeInstanceOf(Response);
  return e as Response;
}

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
    const hanging = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      })) as unknown as typeof fetch;
    const res = await thrown(
      proxy(CDN, "ABC123", { fetch: hanging, maxMs: 50 })
    );
    expect(res.status).toBe(502);
  });

  test("falls back to video/mp4 when upstream sends no content type", async () => {
    const res = await proxy(CDN, "ABC123", {
      fetch: stubFetch(() => new Response("x", { status: 200 })),
    });
    expect(res.headers.get("content-type")).toBe("video/mp4");
  });

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
