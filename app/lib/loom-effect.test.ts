import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveLoomProgram, toThrownError } from "./loom-effect";

const publicHost = () => ["93.184.216.34"];

const page = (body: string, init?: ResponseInit) =>
  new Response(`<html><head>${body}</head></html>`, { status: 200, ...init });

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const LOOM_URL = "https://www.loom.com/share/abc123xyz";

const runLoom = (layer: Layer.Layer<FetchDeps>, sourceUrl: string = LOOM_URL) =>
  Effect.runPromise(Effect.provide(resolveLoomProgram({ sourceUrl }), layer));

const runLoomError = (
  layer: Layer.Layer<FetchDeps>,
  sourceUrl: string = LOOM_URL
) =>
  Effect.runPromise(
    Effect.flip(Effect.provide(resolveLoomProgram({ sourceUrl }), layer))
  );

describe("loom-effect", () => {
  test("reads og:video and thumbnail through layers", async () => {
    const streams = await runLoom(
      layersFor(
        stubFetch(() =>
          page(
            `<meta property="og:video" content="https://cdn.loom.com/v.mp4"><meta property="og:image" content="https://cdn.loom.com/img.jpg">`
          )
        )
      )
    );

    expect(streams).toEqual({
      thumbnail: "https://cdn.loom.com/img.jpg",
      videoUrl: "https://cdn.loom.com/v.mp4",
    });
  });

  test("rejects a page with no video", async () => {
    const error = await runLoomError(
      layersFor(stubFetch(() => page("<p>just a photo</p>")))
    );

    expect(error._tag).toBe("LoomNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found. Only public videos are downloadable."
    );
  });

  test("reports a missing post", async () => {
    const error = await runLoomError(
      layersFor(stubFetch(() => new Response("gone", { status: 404 })))
    );

    expect(error._tag).toBe("LoomNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("reports a down upstream", async () => {
    const error = await runLoomError(
      layersFor(stubFetch(() => new Response("boom", { status: 503 })))
    );

    expect(error._tag).toBe("LoomUpstream");
    expect(toThrownError(error).message).toBe(
      "Loom returned 503. Try again later."
    );
  });

  test("refuses a private host with a typed guard failure", async () => {
    const privateLayer = Layer.succeed(FetchDeps)({
      doFetch: stubFetch(() => page("")),
      lookup: () => ["127.0.0.1"],
    });

    const error = await runLoomError(privateLayer);

    expect(error._tag).toBe("LoomGuardBlocked");
    expect(toThrownError(error).message).toBe(
      "Only public links are supported."
    );
  });

  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "LoomUnreachable" as const }).message).toBe(
      "Loom is unreachable right now. Try again later."
    );
    expect(toThrownError({ _tag: "LoomUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
