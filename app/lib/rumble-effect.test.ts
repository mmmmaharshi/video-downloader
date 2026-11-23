import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveRumbleProgram, rumbleErrorMessage } from "./rumble-effect";

const WATCH = "https://rumble.com/v1a2b3c-some-title.html";
const EMBED_ID = "v1a2b3c";

const publicHost = () => ["93.184.216.34"];

const watchPage = () =>
  new Response(
    `<html><head><meta property="og:image" content="https://thumb.example/t.jpg"></head><body><iframe src="https://rumble.com/embed/${EMBED_ID}"></iframe></body></html>`,
    { headers: { "content-type": "text/html" } }
  );

const embedJs = () =>
  Response.json({
    ua: {
      mp4: [
        { meta: { h: 360, w: 640 }, url: "https://cdn.example/v360.mp4" },
        { meta: { h: 1080, w: 1920 }, url: "https://cdn.example/v1080.mp4" },
        { meta: { h: 720, w: 1280 }, url: "https://cdn.example/v720.mp4" },
      ],
    },
  });

const vodFetch = stubFetch((url) =>
  url.includes("/embedJS/") ? embedJs() : watchPage()
);

const vodLayer = Layer.succeed(FetchDeps)({
  doFetch: vodFetch,
  lookup: publicHost,
});

const vodInput = { direct: false, id: EMBED_ID, sourceUrl: WATCH };

const runRumble = (
  layer: Layer.Layer<FetchDeps>,
  input: { direct: boolean; id: string; sourceUrl: string } = vodInput
) => Effect.runPromise(Effect.provide(resolveRumbleProgram(input), layer));

const runRumbleError = (
  layer: Layer.Layer<FetchDeps>,
  input: { direct: boolean; id: string; sourceUrl: string } = vodInput
) =>
  Effect.runPromise(
    Effect.flip(Effect.provide(resolveRumbleProgram(input), layer))
  );

describe("rumble-effect", () => {
  test("resolves VOD streams through layers", async () => {
    const streams = await runRumble(vodLayer);

    expect(streams.mp4s.map((m) => m.url)).toEqual([
      "https://cdn.example/v360.mp4",
      "https://cdn.example/v1080.mp4",
      "https://cdn.example/v720.mp4",
    ]);
    expect(streams.html).toContain(`rumble.com/embed/${EMBED_ID}`);
  });

  test("re-sends the RNSC cookie after a 307 to self", async () => {
    const cookies: (string | null)[] = [];

    const fetch = stubFetch((url, init) => {
      if (url.includes("/embedJS/")) {
        return embedJs();
      }

      cookies.push(new Headers(init?.headers).get("cookie"));

      if (cookies.length === 1) {
        return new Response(null, {
          headers: {
            location: WATCH,
            "set-cookie": "RNSC=abc123; Path=/",
          },
          status: 307,
        });
      }

      return watchPage();
    });

    const layer = Layer.succeed(FetchDeps)({
      doFetch: fetch,
      lookup: publicHost,
    });

    const streams = await runRumble(layer);

    expect(streams.mp4s).toHaveLength(3);
    expect(cookies[1]).toContain("RNSC=abc123");
  });

  test("blocked addresses fail typed", async () => {
    const layer = Layer.succeed(FetchDeps)({
      doFetch: vodFetch,
      lookup: () => ["127.0.0.1"],
    });

    const error = await runRumbleError(layer);

    expect(error._tag).toBe("RumbleGuardBlocked");
    expect(rumbleErrorMessage(error)).toBe("Only public links are supported.");
  });

  test("unresolvable hosts fail typed", async () => {
    const layer = Layer.succeed(FetchDeps)({
      doFetch: vodFetch,
      lookup: () => {
        throw new Error("ENOTFOUND");
      },
    });

    const error = await runRumbleError(layer);

    expect(error._tag).toBe("RumbleUnresolved");
    expect(rumbleErrorMessage(error)).toBe(
      "Could not resolve this link. Check the URL."
    );
  });

  test("a page without an embed id fails typed", async () => {
    const layer = Layer.succeed(FetchDeps)({
      doFetch: stubFetch(
        () => new Response("<html><body>no video here</body></html>")
      ),
      lookup: publicHost,
    });

    const error = await runRumbleError(layer);

    expect(error._tag).toBe("RumbleNoVideo");
    expect(rumbleErrorMessage(error)).toBe(
      "No downloadable video found for this post."
    );
  });

  test("hls-only answers fail typed", async () => {
    const layer = Layer.succeed(FetchDeps)({
      doFetch: stubFetch((url) =>
        url.includes("/embedJS/") ? Response.json({ ua: {} }) : watchPage()
      ),
      lookup: publicHost,
    });

    const error = await runRumbleError(layer);

    expect(error._tag).toBe("RumbleNoVideo");
    expect(rumbleErrorMessage(error)).toBe(
      "No downloadable video found for this post."
    );
  });

  test("a missing embed player fails typed", async () => {
    const layer = Layer.succeed(FetchDeps)({
      doFetch: stubFetch((url) =>
        url.includes("/embedJS/")
          ? new Response("gone", { status: 404 })
          : watchPage()
      ),
      lookup: publicHost,
    });

    const error = await runRumbleError(layer);

    expect(error._tag).toBe("RumbleNotFound");
    expect(rumbleErrorMessage(error)).toBe("Post not found. Check the URL.");
  });

  test("every tag maps to its legacy message", () => {
    expect(
      rumbleErrorMessage({ _tag: "RumbleUnexpectedResponse" as const })
    ).toBe("Rumble returned an unexpected response. Try again later.");

    expect(
      rumbleErrorMessage({ _tag: "RumbleTooManyRedirects" as const })
    ).toBe("This link redirects too many times.");

    expect(rumbleErrorMessage({ _tag: "RumbleBadRedirect" as const })).toBe(
      "This link redirects somewhere invalid."
    );

    expect(
      rumbleErrorMessage({ _tag: "RumbleUpstream", status: 500 } as const)
    ).toBe("Rumble returned 500. Try again later.");
  });
});
