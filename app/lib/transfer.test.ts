import { describe, expect, test } from "bun:test";
import { stubFetch } from "./fake-fetch";
import { isAllowedHost, proxy } from "./transfer";

const CDN = "https://scontent.cdninstagram.com/v/abc.mp4";

function ok(body = "video-bytes", contentType = "video/mp4") {
  return stubFetch(() => new Response(body, { status: 200, headers: { "content-type": contentType } }));
}

async function thrown(p: Promise<unknown>): Promise<Response> {
  const e = await p.catch((e: unknown) => e);
  expect(e).toBeInstanceOf(Response);
  return e as Response;
}

describe("isAllowedHost", () => {
  test("allows Instagram CDN hosts, exact or suffixed", () => {
    expect(isAllowedHost(CDN)).toBe(true);
    expect(isAllowedHost("https://cdninstagram.com/v/x.mp4")).toBe(true);
    expect(isAllowedHost("https://video.fbcdn.net/x.mp4")).toBe(true);
  });

  test("rejects lookalike hosts", () => {
    expect(isAllowedHost("https://evil.com/cdninstagram.com")).toBe(false);
    expect(isAllowedHost("https://cdninstagram.com.evil.com/x")).toBe(false);
    expect(isAllowedHost("https://cdninstagram.com@evil.com/x")).toBe(false);
    expect(isAllowedHost("https://fbcdn.net.evil.com/x")).toBe(false);
  });

  test("rejects anything that is not a URL", () => {
    expect(isAllowedHost("not a url")).toBe(false);
    expect(isAllowedHost("")).toBe(false);
  });

  test("rejects insecure http", () => {
    expect(isAllowedHost("http://scontent.cdninstagram.com/x.mp4")).toBe(false);
  });

  test("allows the X video CDN", () => {
    expect(isAllowedHost("https://video.twimg.com/amplify_video/1/vid/avc1/480x270/x.mp4")).toBe(true);
    expect(isAllowedHost("https://video.twimg.com.evil.com/x.mp4")).toBe(false);
    expect(isAllowedHost("https://pbs.twimg.com/media/x.jpg")).toBe(false);
  });

  test("allows the YouTube media CDN, exact suffix only", () => {
    expect(isAllowedHost("https://rr1---sn-abc123.googlevideo.com/videoplayback?expire=1")).toBe(true);
    expect(isAllowedHost("https://googlevideo.com.evil.com/x.mp4")).toBe(false);
    expect(isAllowedHost("https://evilgooglevideo.com/x.mp4")).toBe(false);
  });
});

describe("proxy", () => {
  test("streams the upstream body as an mp4 attachment", async () => {
    const res = await proxy(CDN, "instagram-ABC123", { fetch: ok() });
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="instagram-ABC123.mp4"');
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(await res.text()).toBe("video-bytes");
  });

  test("names an X download after the tweet", async () => {
    const twimg = "https://video.twimg.com/amplify_video/1/vid/avc1/480x270/x.mp4";
    const res = await proxy(twimg, "twitter-2006763209378922836", { fetch: ok() });
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="twitter-2006763209378922836.mp4"');
  });

  test("strips header-breaking characters out of the download name", async () => {
    const res = await proxy(CDN, 'a"b;c d', { fetch: ok() });
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="a_b_c_d.mp4"');
  });

  test("passes the upstream size through for progress display", async () => {
    const sized = stubFetch(
      () => new Response("video-bytes", { status: 200, headers: { "content-type": "video/mp4", "content-length": "11" } }),
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
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const res = await thrown(proxy(CDN, "ABC123", { fetch: hanging, maxMs: 50 }));
    expect(res.status).toBe(502);
  });

  test("falls back to video/mp4 when upstream sends no content type", async () => {
    const res = await proxy(CDN, "ABC123", { fetch: stubFetch(() => new Response("x", { status: 200 })) });
    expect(res.headers.get("content-type")).toBe("video/mp4");
  });

  test("rejects a missing url with 400", async () => {
    expect((await thrown(proxy("", "ABC123", { fetch: ok() }))).status).toBe(400);
  });

  test("rejects an off-allowlist url with 400 without fetching", async () => {
    const never = stubFetch(() => {
      throw new Error("must not fetch");
    });
    expect((await thrown(proxy("https://evil.com/x.mp4", "ABC123", { fetch: never }))).status).toBe(400);
  });

  test("maps an upstream error status to 502", async () => {
    const failing = stubFetch(() => new Response("nope", { status: 500 }));
    expect((await thrown(proxy(CDN, "ABC123", { fetch: failing }))).status).toBe(502);
  });

  test("maps a bodiless upstream response to 502", async () => {
    const bodiless = stubFetch(() => new Response(null, { status: 200 }));
    expect((await thrown(proxy(CDN, "ABC123", { fetch: bodiless }))).status).toBe(502);
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
