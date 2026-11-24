import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { stubFetch } from "./fake-fetch";
import { FetchDeps } from "./fetch-deps";
import { resolveRumbleProgram, rumbleErrorMessage } from "./rumble-effect";

const WATCH = "https://rumble.com/v1a2b3c-some-title.html";
const EMBED_ID = "v1a2b3c";

const vodFetch = stubFetch(() => new Response("", { status: 200 }));

const vodInput = { direct: false, id: EMBED_ID, sourceUrl: WATCH };

const runRumbleError = (
  layer: Layer.Layer<FetchDeps>,
  input: { direct: boolean; id: string; sourceUrl: string } = vodInput
) =>
  Effect.runPromise(
    Effect.flip(Effect.provide(resolveRumbleProgram(input), layer))
  );

describe("rumble-effect", () => {
  // Behaviour lives in media-resolver.test.ts; this file keeps what
  // the seam cannot reach: a branch it never drives, and the copy.
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
