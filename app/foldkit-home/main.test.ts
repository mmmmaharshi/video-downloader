// Stories for the home widget: dispatch a Message, resolve the Command, assert
// the Model. Each story fails for its own reason — no shared setup to blame.

import { describe, expect, test } from "bun:test";

import { Command, given, message, model, story } from "foldkit/story";

import { EMPTY_LINK } from "../lib/messages";
import { init, Message, ResolveUrl, update } from "./main";

const asset = {
  downloadHref: "/api/download?url=x",
  label: "720p",
  platform: "youtube",
  shortcode: "dQw4w9WgXcQ",
  sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
  thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  videoUrl: "https://x/720.mp4",
};

describe("foldkit-home", () => {
  test("starts idle with a blank form", () => {
    expect(init().model).toEqual({
      assets: [],
      error: "",
      status: "idle",
      url: "",
    });
  });

  test("typing stores the url without fetching", () => {
    story(
      update,
      given(init().model),
      message(Message.ChangedUrl({ value: "https://youtu.be/x" })),
      Command.expectNone(),
      model((m) => {
        expect(m.url).toBe("https://youtu.be/x");
        expect(m.status).toBe("idle");
      })
    );
  });

  test("blank submit fails inline instead of fetching", () => {
    story(
      update,
      given(init().model),
      message(Message.SubmittedForm()),
      Command.expectNone(),
      model((m) => {
        expect(m.status).toBe("failed");
        expect(m.error).toBe(EMPTY_LINK);
      })
    );
  });

  test("submit dispatches one resolve for the trimmed url", () => {
    story(
      update,
      given({ ...init().model, url: "  https://youtu.be/x  " }),
      message(Message.SubmittedForm()),
      Command.expectExact(ResolveUrl({ url: "https://youtu.be/x" })),
      Command.resolve(ResolveUrl, Message.SucceededResolve({ assets: [] })),
      model((m) => {
        expect(m.status).toBe("ready");
      })
    );
  });

  test("a resolved answer replaces the list", () => {
    story(
      update,
      given({ ...init().model, status: "loading", url: "https://youtu.be/x" }),
      message(Message.SucceededResolve({ assets: [asset] })),
      Command.expectNone(),
      model((m) => {
        expect(m.status).toBe("ready");
        expect(m.assets.map((a) => a.label)).toEqual(["720p"]);
      })
    );
  });

  test("a server error surfaces its message", () => {
    story(
      update,
      given({ ...init().model, status: "loading", url: "https://youtu.be/x" }),
      message(Message.FailedResolve({ error: "Post not found." })),
      Command.expectNone(),
      model((m) => {
        expect(m.status).toBe("failed");
        expect(m.error).toBe("Post not found.");
        expect(m.assets).toEqual([]);
      })
    );
  });
});
