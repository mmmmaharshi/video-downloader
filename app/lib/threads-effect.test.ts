import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveThreadsProgram, toThrownError } from "./threads-effect";

const publicHost = () => ["93.184.216.34"];

const page = (body: string, init?: ResponseInit) =>
  new Response(`<html><head>${body}</head></html>`, { status: 200, ...init });

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const THREADS_URL = "https://www.threads.net/@user/post/ABC123";

const runThreads = (
  layer: Layer.Layer<FetchDeps>,
  sourceUrl: string = THREADS_URL
) =>
  Effect.runPromise(
    Effect.provide(resolveThreadsProgram({ sourceUrl }), layer)
  );

const runThreadsError = (
  layer: Layer.Layer<FetchDeps>,
  sourceUrl: string = THREADS_URL
) =>
  Effect.runPromise(
    Effect.flip(Effect.provide(resolveThreadsProgram({ sourceUrl }), layer))
  );

describe("threads-effect", () => {
  test("reads og:video and thumbnail through layers", async () => {
    const streams = await runThreads(
      layersFor(
        stubFetch(() =>
          page(
            `<meta property="og:video" content="https://cdn.threads.com/v.mp4"><meta property="og:image" content="https://cdn.threads.com/img.jpg">`
          )
        )
      )
    );

    expect(streams).toEqual({
      thumbnail: "https://cdn.threads.com/img.jpg",
      videoUrl: "https://cdn.threads.com/v.mp4",
    });
  });

  test("rejects a page with no video", async () => {
    const error = await runThreadsError(
      layersFor(stubFetch(() => page("<p>just text</p>")))
    );

    expect(error._tag).toBe("ThreadsNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found. Only video posts are downloadable."
    );
  });

  test("reports a missing post", async () => {
    const error = await runThreadsError(
      layersFor(stubFetch(() => new Response("gone", { status: 404 })))
    );

    expect(error._tag).toBe("ThreadsNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("reports a down upstream", async () => {
    const error = await runThreadsError(
      layersFor(stubFetch(() => new Response("boom", { status: 503 })))
    );

    expect(error._tag).toBe("ThreadsUpstream");
    expect(toThrownError(error).message).toBe(
      "Threads returned 503. Try again later."
    );
  });

  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "ThreadsUnreachable" as const }).message).toBe(
      "Threads is unreachable right now. Try again later."
    );
    expect(
      toThrownError({ _tag: "ThreadsGuardBlocked" as const }).message
    ).toBe("Only public links are supported.");
    expect(toThrownError({ _tag: "ThreadsUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
