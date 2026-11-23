import { describe, expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveInstagramProgram, toThrownError } from "./instagram-effect";

const REEL = "https://www.instagram.com/reel/ABC123/";
const CDN = "https://scontent.cdninstagram.com/v/abc.mp4";

const publicHost = () => ["93.184.216.34"];

const page = (body: string, init?: ResponseInit) =>
  new Response(`<html><head>${body}</head></html>`, { status: 200, ...init });

// Response.url and .redirected are read-only, so a login-redirect fixture
// subclasses to supply them. The program reads only ok/redirected/status/text/url.
class LoginRedirectResponse extends Response {
  private readonly loginUrl: string;

  constructor(loginUrl: string) {
    super("", { status: 200 });
    this.loginUrl = loginUrl;
  }

  // eslint-disable-next-line class-methods-use-this -- instance getter override; a static would not shadow the base property
  override get redirected(): boolean {
    return true;
  }

  override get url(): string {
    return this.loginUrl;
  }
}

const layersFor = (doFetch: ReturnType<typeof stubFetch>) =>
  Layer.succeed(FetchDeps)({ doFetch, lookup: publicHost });

const runStreams = (
  layer: Layer.Layer<FetchDeps>,
  sourceUrl: string = REEL,
  shortcode = "ABC123"
) =>
  Effect.runPromise(
    Effect.provide(resolveInstagramProgram({ shortcode, sourceUrl }), layer)
  );

const runStreamsError = (
  layer: Layer.Layer<FetchDeps>,
  sourceUrl: string = REEL,
  shortcode = "ABC123"
) =>
  Effect.runPromise(
    Effect.flip(
      Effect.provide(resolveInstagramProgram({ shortcode, sourceUrl }), layer)
    )
  );

describe("instagram-effect", () => {
  test("reads video and thumbnail from the post page through layers", async () => {
    const streams = await runStreams(
      layersFor(
        stubFetch(() =>
          page(
            `<meta property="og:video:secure_url" content="${CDN}"><meta property="og:image" content="https://img.example/x.jpg">`
          )
        )
      )
    );

    expect(streams).toEqual({
      thumbnail: "https://img.example/x.jpg",
      videoUrl: CDN,
    });
  });

  test("falls back to the embed page when the post page has no video tag", async () => {
    const streams = await runStreams(
      layersFor(
        stubFetch((url) =>
          url.includes("/embed/")
            ? page(
                `"video_url":"https:\\/\\/scontent.cdninstagram.com\\/v\\/embed.mp4"`
              )
            : page("<p>no player here</p>")
        )
      )
    );

    expect(streams.videoUrl).toBe(
      "https://scontent.cdninstagram.com/v/embed.mp4"
    );
  });

  test("a login redirect fails typed", async () => {
    const error = await runStreamsError(
      layersFor(
        stubFetch(
          () =>
            new LoginRedirectResponse(
              "https://www.instagram.com/accounts/login/"
            )
        )
      )
    );

    expect(error._tag).toBe("InstagramLoginRedirect");
    expect(toThrownError(error).message).toBe(
      "Private or login-required post. Only public posts are supported."
    );
  });

  test("a login wall fails typed", async () => {
    const error = await runStreamsError(
      layersFor(stubFetch(() => page(`<a href="/accounts/login/">Log in</a>`)))
    );

    expect(error._tag).toBe("InstagramLoginWall");
    expect(toThrownError(error).message).toBe(
      "Private post or requires login. Only public posts work."
    );
  });

  test("a missing post fails typed", async () => {
    const error = await runStreamsError(
      layersFor(stubFetch(() => new Response("gone", { status: 404 })))
    );

    expect(error._tag).toBe("InstagramNotFound");
    expect(toThrownError(error).message).toBe("Post not found. Check the URL.");
  });

  test("a down upstream fails typed", async () => {
    const error = await runStreamsError(
      layersFor(stubFetch(() => new Response("boom", { status: 503 })))
    );

    expect(error._tag).toBe("InstagramUpstream");
    expect(toThrownError(error).message).toBe(
      "Instagram returned 503. Try again later."
    );
  });

  test("a post with no video fails typed", async () => {
    const error = await runStreamsError(
      layersFor(stubFetch(() => page("<p>just a photo</p>")))
    );

    expect(error._tag).toBe("InstagramNoVideo");
    expect(toThrownError(error).message).toBe(
      "No video found. Only video/reel posts are downloadable, or IG changed its page."
    );
  });

  test("every tag maps to its legacy message", () => {
    expect(
      toThrownError({ _tag: "InstagramUnreachable" as const }).message
    ).toBe("Instagram is unreachable right now. Try again later.");
    expect(
      toThrownError({ _tag: "InstagramGuardBlocked" as const }).message
    ).toBe("Only public links are supported.");
    expect(
      toThrownError({ _tag: "InstagramUnresolved" as const }).message
    ).toBe("Could not resolve this link. Check the URL.");
  });
});
