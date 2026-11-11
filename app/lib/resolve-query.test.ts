import { describe, expect, test } from "bun:test";

import { toDownloadHref } from "./download-link";
import { stubFetch } from "./fake-fetch";
import { resolve } from "./media-resolver";
import {
  isFresh,
  resolveKey,
  resolveResultSchema,
  stemOf,
} from "./resolve-query";

describe("resolve-query", () => {
  test("keys a resolution by its trimmed url", () => {
    expect(resolveKey("  https://x.com/a  ")).toEqual([
      "resolve",
      "https://x.com/a",
    ]);
  });

  test("freshness ends where the download gate ends", () => {
    expect(isFresh(Date.now() - 9 * 60_000)).toBe(true);
    expect(isFresh(Date.now() - 11 * 60_000)).toBe(false);
  });

  test("accepts what the resolver and the signer produce", async () => {
    const assets = await resolve(
      "https://cdn.example.com/clips/funny-cat.mp4",
      {
        fetch: stubFetch(
          () =>
            new Response("bytes", {
              headers: { "content-type": "video/mp4" },
              status: 200,
            })
        ),
        lookup: () => ["93.184.216.34"],
      }
    );

    const withHref = assets.map((asset, index) => ({
      ...asset,
      downloadHref: toDownloadHref(assets, index, {
        now: 0,
        secret: "test-secret",
      }),
    }));

    expect(resolveResultSchema.parse({ assets: withHref })).toEqual({
      assets: withHref,
    });
  });

  test("reads the download stem back out of the href", () => {
    expect(
      stemOf("/api/download?url=https%3A%2F%2Fx.mp4&name=twitter-99&e=1&s=2")
    ).toBe("twitter-99");
    expect(stemOf("/api/download?url=https%3A%2F%2Fx.mp4")).toBe("video");
  });
});
