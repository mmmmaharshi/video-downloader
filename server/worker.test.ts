// Worker entry tests: routing, secret plumbing, and transport injection —
// without touching Cloudflare. The platform only adds static assets around
// this function.

import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import { toDownloadHref } from "../app/lib/download-link";
import { stubFetch } from "../app/lib/fake-fetch";
import type { VideoAsset } from "../app/lib/resolve-query";
import { resolveResultSchema } from "../app/lib/resolve-query";
import { handleWorkerRequest } from "./worker";

const lookup = () => ["93.184.216.34"];
const env = { DOWNLOAD_SECRET: "test-secret" };

const mp4 = (body = "video-bytes") =>
  stubFetch(
    () =>
      new Response(body, {
        headers: { "content-type": "video/mp4" },
        status: 200,
      })
  );

const asset = (videoUrl: string): VideoAsset => ({
  platform: "direct",
  shortcode: "funny-cat",
  sourceUrl: videoUrl,
  videoUrl,
});

const postResolve = (url: string) => {
  const form = new FormData();

  form.set("url", url);

  return new Request("http://localhost/api/resolve", {
    body: form,
    method: "POST",
  });
};

describe("handleWorkerRequest", () => {
  test("resolves through the shared handler", async () => {
    const res = await handleWorkerRequest(
      postResolve("https://cdn.example.com/clips/funny-cat.mp4"),
      env,
      { fetch: mp4(), lookup }
    );

    const decoded = Schema.decodeUnknownSync(resolveResultSchema)(
      await res.json()
    );

    if (!("assets" in decoded)) {
      throw new Error("expected resolved assets");
    }

    expect(res.status).toBe(200);
    expect(decoded.assets).toHaveLength(1);
    expect(decoded.assets[0]?.videoUrl).toBe(
      "https://cdn.example.com/clips/funny-cat.mp4"
    );
  });

  test("answers unknown paths without touching the domain", async () => {
    const res = await handleWorkerRequest(
      new Request("http://localhost/favicon.ico"),
      env,
      { fetch: mp4(), lookup }
    );

    expect(res.status).toBe(404);
  });

  test("a missing secret fails closed, not open", async () => {
    const res = await handleWorkerRequest(
      postResolve("https://cdn.example.com/clips/funny-cat.mp4"),
      {},
      { fetch: mp4(), lookup }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      error: "DOWNLOAD_SECRET is not set",
    });
  });

  test("a signed download streams through the worker boundary", async () => {
    const videoUrl = "https://cdn.example.com/clips/funny-cat.mp4";

    const href = toDownloadHref([asset(videoUrl)], 0, {
      secret: env.DOWNLOAD_SECRET,
    });

    const res = await handleWorkerRequest(
      new Request(`http://localhost${href}`),
      env,
      { fetch: mp4(), lookup }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="direct-funny-cat.mp4"'
    );
    expect(await res.text()).toBe("video-bytes");
  });
});
