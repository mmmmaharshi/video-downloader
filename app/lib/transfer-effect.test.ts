import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { toThrownResponse, transferProgram } from "./transfer-effect";

const publicHost = () => ["93.184.216.34"];

const CDN = "https://scontent.cdninstagram.com/v/abc.mp4";

const video = (
  body: string | ReadableStream<Uint8Array> = "video-bytes",
  contentType = "video/mp4",
  init: ResponseInit = {}
) =>
  stubFetch(
    () =>
      new Response(body, {
        headers: { "content-type": contentType },
        status: 200,
        ...init,
      })
  );

const layerFor = (
  doFetch: ReturnType<typeof stubFetch>,
  lookup: () => string[] = publicHost
) => Layer.succeed(FetchDeps)({ doFetch, lookup });

const input = (
  overrides: Partial<{
    maxBytes: number;
    maxMs: number;
    range: string | null;
    stem: string;
    videoUrl: string;
  }> = {}
) => ({
  maxBytes: 1024 ** 3,
  maxMs: 4 * 60_000,
  range: null,
  stem: "instagram-ABC123",
  videoUrl: CDN,
  ...overrides,
});

const runTransfer = (
  layer: Layer.Layer<FetchDeps>,
  args: ReturnType<typeof input> = input()
) => Effect.runPromise(Effect.provide(transferProgram(args), layer));

const runTransferError = (
  layer: Layer.Layer<FetchDeps>,
  args: ReturnType<typeof input> = input()
) =>
  Effect.runPromise(Effect.flip(Effect.provide(transferProgram(args), layer)));

describe("transfer-effect", () => {
  test("streams a full file with download naming", async () => {
    const res = await runTransfer(layerFor(video()));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="instagram-ABC123.mp4"'
    );
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await res.text()).toBe("video-bytes");
  });

  test("refuses a file over the byte cap", async () => {
    const big = stubFetch(
      () =>
        new Response("video-bytes", {
          headers: {
            "content-length": String(1024 ** 3 + 1),
            "content-type": "video/mp4",
          },
        })
    );

    const error = await runTransferError(layerFor(big));

    expect(error._tag).toBe("TransferTooLarge");

    const thrown = toThrownResponse(error);

    expect(thrown.status).toBe(413);
    expect(await thrown.text()).toBe("This file is too large to download here");
  });

  test("passes a byte-range answer straight through", async () => {
    const sliced = stubFetch(
      () =>
        new Response("bytes", {
          headers: {
            "accept-ranges": "bytes",
            "content-length": "5",
            "content-range": "bytes 0-4/100",
            "content-type": "video/mp4",
          },
          status: 206,
        })
    );

    const res = await runTransfer(
      layerFor(sliced),
      input({ range: "bytes=0-4" })
    );

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-4/100");
    expect(await res.text()).toBe("bytes");
  });

  test("rewrites manifest references absolute", async () => {
    const res = await runTransfer(
      layerFor(video("#EXTM3U\nseg1.ts\n", "application/x-mpegURL")),
      input({ videoUrl: "https://cdn.example/list.m3u8" })
    );

    expect(await res.text()).toBe("#EXTM3U\nhttps://cdn.example/seg1.ts\n");
  });

  test("refuses a private host", async () => {
    const error = await runTransferError(
      layerFor(video(), () => ["127.0.0.1"])
    );

    expect(error._tag).toBe("TransferForbidden");

    const thrown = toThrownResponse(error);

    expect(thrown.status).toBe(403);
    expect(await thrown.text()).toBe("Only public links are supported");
  });

  test("reports an unreachable upstream", async () => {
    const down = stubFetch(() => {
      throw new TypeError("fetch failed");
    });

    const error = await runTransferError(layerFor(down));

    expect(error._tag).toBe("TransferUnreachable");

    const thrown = toThrownResponse(error);

    expect(thrown.status).toBe(502);
    expect(await thrown.text()).toBe("Upstream unreachable");
  });

  test("reports a bad upstream status", async () => {
    const gone = stubFetch(() => new Response("gone", { status: 502 }));

    const error = await runTransferError(layerFor(gone));

    expect(error._tag).toBe("TransferBadUpstream");

    const thrown = toThrownResponse(error);

    expect(thrown.status).toBe(502);
    expect(await thrown.text()).toBe("Upstream 502");
  });

  test("every tag maps to its legacy response", () => {
    expect(
      toThrownResponse({ _tag: "TransferForbidden" as const }).status
    ).toBe(403);
    expect(
      toThrownResponse({ _tag: "TransferUnreachable" as const }).status
    ).toBe(502);
    expect(
      toThrownResponse({ _tag: "TransferBadUpstream", status: 500 } as const)
        .status
    ).toBe(502);
    expect(toThrownResponse({ _tag: "TransferTooLarge" as const }).status).toBe(
      413
    );
  });
});
