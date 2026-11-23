import { describe, expect, test } from "bun:test";

import { Schema } from "effect";

import { toDownloadHref } from "./download-link";
import { stubFetch } from "./fake-fetch";
import { resolve } from "./media-resolver";
import { resolveResultSchema } from "./resolve-query";

describe("resolve-query", () => {
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

    expect(
      Schema.decodeUnknownSync(resolveResultSchema)({ assets: withHref })
    ).toEqual({
      assets: withHref,
    });
  });
});
