// Handler tests: the HTTP boundary answers, the domain decides. A stub fetch
// and fixed secret/now keep every case deterministic.

import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import { toDownloadHref } from "../app/lib/download-link";
import { stubFetch } from "../app/lib/fake-fetch";
import type { VideoAsset } from "../app/lib/resolve-query";
import { resolveResultSchema } from "../app/lib/resolve-query";
import { handleDownload, handleResolve } from "./api";

const lookup = () => ["93.184.216.34"];
const secret = "test-secret";
const now = 1_000_000;

const asset = (videoUrl: string): VideoAsset => ({
  platform: "direct",
  shortcode: "funny-cat",
  sourceUrl: videoUrl,
  videoUrl,
});

const mp4 = (body = "video-bytes") =>
  stubFetch(
    () =>
      new Response(body, {
        headers: { "content-type": "video/mp4" },
        status: 200,
      })
  );

const postResolve = (url: string) => {
  const form = new FormData();

  form.set("url", url);

  return new Request("http://localhost/api/resolve", {
    body: form,
    method: "POST",
  });
};

describe("handleResolve", () => {
  test("signs the resolved assets where the secret lives", async () => {
    const res = await handleResolve(
      postResolve("https://cdn.example.com/clips/funny-cat.mp4"),
      { fetch: mp4(), lookup, now, secret }
    );

    const decoded = Schema.decodeUnknownSync(resolveResultSchema)(
      await res.json()
    );

    if (!("assets" in decoded)) {
      throw new Error("expected resolved assets");
    }

    expect(decoded.assets).toHaveLength(1);
    expect(decoded.assets[0]?.downloadHref).toContain("name=direct-funny-cat");
    expect(decoded.assets[0]?.videoUrl).toBe(
      "https://cdn.example.com/clips/funny-cat.mp4"
    );
  });

  test("answers an unresolvable link with an error, not a throw", async () => {
    const res = await handleResolve(postResolve(":::"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      error: "Invalid URL. Paste a link to a video page or file.",
    });
  });
});

describe("handleDownload", () => {
  test("streams a signed href as an attachment", async () => {
    const videoUrl = "https://cdn.example.com/clips/funny-cat.mp4";
    const href = toDownloadHref([asset(videoUrl)], 0, { now, secret });

    const res = await handleDownload(new Request(`http://localhost${href}`), {
      fetch: mp4(),
      lookup,
      now,
      secret,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="direct-funny-cat.mp4"'
    );
    expect(await res.text()).toBe("video-bytes");
  });

  test("answers an unsigned href with the 403, not a throw", async () => {
    const res = await handleDownload(
      new Request(
        "http://localhost/api/download?url=https://x/y.mp4&name=x-1&e=1&s=bad"
      ),
      { now, secret }
    );

    expect(res.status).toBe(403);
  });
});
