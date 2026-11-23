// Stories for the home widget: dispatch a Message, resolve the Command, assert
// the Model. Each story fails for its own reason — no shared setup to blame.

import { Command, given, message, model, story } from "foldkit/story";
import { describe, expect, test } from "vitest";

import { EMPTY_LINK } from "../lib/messages";
import {
  ConvertGif,
  CopyGif,
  GoDownload,
  init,
  Message,
  ResolveUrl,
  SaveGif,
  update,
} from "./main";
import type { Asset } from "./main";

const gifAsset: Asset = {
  downloadHref: "/api/download?url=xgif",
  gif: "video",
  platform: "twitter",
  shortcode: "1",
  sourceUrl: "https://x.com/u/status/1",
  videoUrl: "https://x/1.mp4",
};

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
    const { model: initial } = init();

    expect(initial.assets).toEqual([]);
    expect(initial.conversions).toEqual({});
    expect(initial.copying).toEqual([]);
    expect(initial.error).toBe("");
    expect(initial.notice).toBe("");
    expect(initial.pendingCopies).toEqual([]);
    expect(initial.pendingDownloads).toEqual([]);
    expect(initial.status).toBe("idle");
    expect(initial.url).toBe("");
    // init probes the runtime: no Worker or clipboard under node
    expect(initial.capabilities).toEqual({ clipboard: false, worker: false });
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

  test("resolve prefetches the conversion for an X gif", () => {
    story(
      update,
      given({
        ...init().model,
        capabilities: { clipboard: false, worker: true },
        status: "loading",
      }),
      message(Message.SucceededResolve({ assets: [gifAsset] })),
      Command.expectExact(
        ConvertGif({
          downloadHref: "/api/download?url=xgif",
          videoUrl: "https://x/1.mp4",
        })
      ),
      Command.resolve(
        ConvertGif,
        Message.SucceededConvertGif({
          blob: new Blob(["gif"], { type: "image/gif" }),
          videoUrl: "https://x/1.mp4",
        })
      ),
      model((m) => {
        expect(m.conversions["https://x/1.mp4"]?._tag).toBe("Success");
      })
    );
  });

  test("resolve skips prefetch without a worker", () => {
    story(
      update,
      given({
        ...init().model,
        capabilities: { clipboard: false, worker: false },
        status: "loading",
      }),
      message(Message.SucceededResolve({ assets: [gifAsset] })),
      Command.expectNone(),
      model((m) => {
        expect(m.conversions).toEqual({});
      })
    );
  });

  test("download click converts, then saves the gif on success", () => {
    const blob = new Blob(["gif"], { type: "image/gif" });

    story(
      update,
      given({
        ...init().model,
        assets: [gifAsset],
        capabilities: { clipboard: false, worker: true },
        status: "ready",
      }),
      message(Message.ClickedDownloadGif({ videoUrl: "https://x/1.mp4" })),
      Command.expectExact(
        ConvertGif({
          downloadHref: "/api/download?url=xgif",
          videoUrl: "https://x/1.mp4",
        })
      ),
      Command.resolve(
        ConvertGif,
        Message.SucceededConvertGif({ blob, videoUrl: "https://x/1.mp4" })
      ),
      Command.expectExact(
        SaveGif({
          blob,
          filename: "twitter-1.gif",
          videoUrl: "https://x/1.mp4",
        })
      ),
      Command.resolve(
        SaveGif,
        Message.CompletedSaveGif({ videoUrl: "https://x/1.mp4" })
      ),
      model((m) => {
        expect(m.conversions["https://x/1.mp4"]?._tag).toBe("Success");
        expect(m.pendingDownloads).toEqual([]);
      })
    );
  });

  test("a failed conversion downloads the original instead", () => {
    story(
      update,
      given({
        ...init().model,
        assets: [gifAsset],
        capabilities: { clipboard: false, worker: true },
        status: "ready",
      }),
      message(Message.ClickedDownloadGif({ videoUrl: "https://x/1.mp4" })),
      Command.expectExact(
        ConvertGif({
          downloadHref: "/api/download?url=xgif",
          videoUrl: "https://x/1.mp4",
        })
      ),
      Command.resolve(
        ConvertGif,
        Message.FailedConvertGif({ videoUrl: "https://x/1.mp4" })
      ),
      Command.expectExact(
        GoDownload({
          href: "/api/download?url=xgif",
          videoUrl: "https://x/1.mp4",
        })
      ),
      Command.resolve(
        GoDownload,
        Message.CompletedGoDownload({ videoUrl: "https://x/1.mp4" })
      ),
      model((m) => {
        expect(m.notice).toBe(
          "Conversion failed, getting the original instead."
        );
      })
    );
  });

  test("copy click converts first, then copies the gif", () => {
    const blob = new Blob(["gif"], { type: "image/gif" });

    story(
      update,
      given({
        ...init().model,
        assets: [gifAsset],
        capabilities: { clipboard: true, worker: true },
        status: "ready",
      }),
      message(Message.ClickedCopyGif({ videoUrl: "https://x/1.mp4" })),
      Command.expectExact(
        ConvertGif({
          downloadHref: "/api/download?url=xgif",
          videoUrl: "https://x/1.mp4",
        })
      ),
      Command.resolve(
        ConvertGif,
        Message.SucceededConvertGif({ blob, videoUrl: "https://x/1.mp4" })
      ),
      Command.expectExact(
        CopyGif({
          blob,
          downloadHref: "/api/download?url=xgif",
          kind: "video",
          videoUrl: "https://x/1.mp4",
        })
      ),
      Command.resolve(
        CopyGif,
        Message.SucceededCopyGif({ mode: "gif", videoUrl: "https://x/1.mp4" })
      ),
      model((m) => {
        expect(m.pendingCopies).toEqual([]);
        expect(m.notice).toBe("Copied — paste it anywhere to share the GIF.");
      })
    );
  });

  test("a finished copy reports what the clipboard took", () => {
    story(
      update,
      given({ ...init().model, copying: ["https://x/1.mp4"] }),
      message(
        Message.SucceededCopyGif({ mode: "gif", videoUrl: "https://x/1.mp4" })
      ),
      Command.expectNone(),
      model((m) => {
        expect(m.copying).toEqual([]);
        expect(m.notice).toBe("Copied — paste it anywhere to share the GIF.");
      })
    );
  });

  test("a conversion for a dropped list is ignored", () => {
    story(
      update,
      given(init().model),
      message(
        Message.SucceededConvertGif({
          blob: new Blob(["gif"], { type: "image/gif" }),
          videoUrl: "https://x/gone.mp4",
        })
      ),
      Command.expectNone(),
      model((m) => {
        expect(m.conversions).toEqual({});
      })
    );
  });
});
