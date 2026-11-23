// Module: FoldkitHome — the home view as a Foldkit program.
// Model, verb-first Messages, exhaustive update, view, and Commands. The
// Schema-typed boundary is the /api/resolve response, validated with the
// shared Schema contract.

import { Effect, Schema } from "effect";
import { AsyncData, Command } from "foldkit";
import type { Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";

import { containerOf, isManifestContainer } from "../lib/container";
import { FRESH_MS } from "../lib/freshness";
import {
  canCopyGif,
  convertedReps,
  convertMp4ToGif,
  gifFileReps,
  hasWorker,
} from "../lib/gif-convert";
import type { ClipboardReps } from "../lib/gif-convert";
import { EMPTY_LINK } from "../lib/messages";
import { resolveResultSchema } from "../lib/resolve-query";

// eslint-disable-next-line no-redeclare -- Foldkit documents the Schema value and its Type alias under one name
export const Asset = Schema.Struct({
  downloadHref: Schema.String,
  gif: Schema.optional(Schema.Literals(["file", "video"])),
  label: Schema.optional(Schema.String),
  platform: Schema.String,
  shortcode: Schema.String,
  sourceUrl: Schema.String,
  thumbnail: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  videoUrl: Schema.String,
});

export type Asset = typeof Asset.Type;

// One conversion per asset url: AsyncData carries the blob on success so the
// download and copy flows read it back without a second conversion.
const GifConversion = AsyncData.Schema(Schema.instanceOf(Blob), Schema.String);

// eslint-disable-next-line no-redeclare -- Foldkit documents the Schema value and its Type alias under one name
export const Model = Schema.Struct({
  assets: Schema.Array(Asset),
  capabilities: Schema.Struct({
    clipboard: Schema.Boolean,
    worker: Schema.Boolean,
  }),
  conversions: Schema.Record(Schema.String, GifConversion.schema),
  copying: Schema.Array(Schema.String),
  error: Schema.String,
  notice: Schema.String,
  pendingCopies: Schema.Array(Schema.String),
  pendingDownloads: Schema.Array(Schema.String),
  recent: Schema.optional(
    Schema.Struct({
      assets: Schema.Array(Asset),
      at: Schema.Number,
      url: Schema.String,
    })
  ),
  status: Schema.Literals(["idle", "loading", "ready", "failed"]),
  url: Schema.String,
});

export type Model = typeof Model.Type;

// eslint-disable-next-line no-redeclare -- Foldkit documents the Schema value and its Type alias under one name
export const Message = defineMessageUnion({
  ChangedUrl: { value: Schema.String },
  ClickedCopyGif: { videoUrl: Schema.String },
  ClickedDownloadGif: { videoUrl: Schema.String },
  CompletedGoDownload: { videoUrl: Schema.String },
  CompletedSaveGif: { videoUrl: Schema.String },
  FailedConvertGif: { videoUrl: Schema.String },
  FailedCopyGif: { videoUrl: Schema.String },
  FailedResolve: { error: Schema.String },
  SubmittedForm: {},
  SucceededClock: { now: Schema.Number, url: Schema.String },
  SucceededConvertGif: {
    blob: Schema.instanceOf(Blob),
    videoUrl: Schema.String,
  },
  SucceededCopyGif: {
    mode: Schema.Literals(["gif", "link"]),
    videoUrl: Schema.String,
  },
  SucceededResolve: {
    assets: Schema.Array(Asset),
    resolvedAt: Schema.Number,
    url: Schema.String,
  },
});

export type Message = typeof Message.Type;

const NETWORK_ERROR = "Network error. Check your connection and try again.";

export const ResolveUrl = Command.define("ResolveUrl", {
  args: { url: Schema.String },
  execute: ({ url }) =>
    Effect.gen(function* resolve() {
      const form = new FormData();

      form.set("url", url);

      const response = yield* Effect.tryPromise({
        catch: () => new Error(NETWORK_ERROR),
        try: () => fetch("/api/resolve", { body: form, method: "POST" }),
      });

      const json: unknown = yield* Effect.tryPromise({
        catch: () => new Error(NETWORK_ERROR),
        try: () => response.json(),
      });

      let decoded: typeof resolveResultSchema.Type;

      try {
        decoded = Schema.decodeUnknownSync(resolveResultSchema)(json);
      } catch {
        return Message.FailedResolve({ error: "Bad response. Try again." });
      }

      if ("error" in decoded) {
        return Message.FailedResolve({ error: decoded.error });
      }

      return Message.SucceededResolve({
        assets: decoded.assets,
        resolvedAt: Date.now(),
        url,
      });
    }).pipe(
      Effect.orElseSucceed(() =>
        Message.FailedResolve({ error: NETWORK_ERROR })
      )
    ),
  messages: [Message.SucceededResolve, Message.FailedResolve],
});

// Update stays pure: the one timestamp it needs arrives through this Command,
// so Stories pin time exactly and the cache gate never depends on the clock
// where it cannot be observed.
export const ReadClock = Command.define("ReadClock", {
  args: { url: Schema.String },
  execute: ({ url }) =>
    Effect.sync(() => Date.now()).pipe(
      Effect.map((now) => Message.SucceededClock({ now, url }))
    ),
  messages: [Message.SucceededClock],
});

export const ConvertGif = Command.define("ConvertGif", {
  args: { downloadHref: Schema.String, videoUrl: Schema.String },
  execute: ({ downloadHref, videoUrl }) =>
    Effect.tryPromise({
      catch: () => new Error("convert failed"),
      try: () => convertMp4ToGif(downloadHref),
    }).pipe(
      Effect.map((blob) => Message.SucceededConvertGif({ blob, videoUrl })),
      Effect.orElseSucceed(() => Message.FailedConvertGif({ videoUrl }))
    ),
  messages: [Message.SucceededConvertGif, Message.FailedConvertGif],
});

// An anchor download needs a click on an attached node; some browsers ignore
// clicks on detached nodes, so the node is attached, clicked, and removed.
const saveBlob = (blob: Blob, filename: string): void => {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};

export const SaveGif = Command.define("SaveGif", {
  args: {
    blob: Schema.instanceOf(Blob),
    filename: Schema.String,
    videoUrl: Schema.String,
  },
  execute: ({ blob, filename, videoUrl }) =>
    Effect.sync(() => saveBlob(blob, filename)).pipe(
      Effect.as(Message.CompletedSaveGif({ videoUrl }))
    ),
  messages: [Message.CompletedSaveGif],
});

export const GoDownload = Command.define("GoDownload", {
  args: { href: Schema.String, videoUrl: Schema.String },
  execute: ({ href, videoUrl }) =>
    Effect.sync(() => {
      window.location.href = href;
    }).pipe(Effect.as(Message.CompletedGoDownload({ videoUrl }))),
  messages: [Message.CompletedGoDownload],
});

const writeClipboard = async (reps: ClipboardReps): Promise<void> => {
  await navigator.clipboard.write([new ClipboardItem(reps)]);
};

export const CopyGif = Command.define("CopyGif", {
  args: {
    blob: Schema.optional(Schema.instanceOf(Blob)),
    downloadHref: Schema.String,
    kind: Schema.Literals(["file", "video"]),
    videoUrl: Schema.String,
  },
  execute: ({ blob, downloadHref, kind, videoUrl }) =>
    Effect.tryPromise({
      catch: () => new Error("copy failed"),
      try: async () => {
        try {
          if (kind === "video") {
            if (!blob) {
              throw new Error("no converted gif yet");
            }

            await writeClipboard(await convertedReps(blob, videoUrl));

            return Message.SucceededCopyGif({ mode: "gif", videoUrl });
          }

          await writeClipboard(await gifFileReps(videoUrl, downloadHref));

          return Message.SucceededCopyGif({ mode: "gif", videoUrl });
        } catch {
          await navigator.clipboard.writeText(videoUrl);

          return Message.SucceededCopyGif({ mode: "link", videoUrl });
        }
      },
    }).pipe(Effect.orElseSucceed(() => Message.FailedCopyGif({ videoUrl }))),
  messages: [Message.SucceededCopyGif, Message.FailedCopyGif],
});

export const init = (): Update.Return<Model, Message> => ({
  model: {
    assets: [],
    capabilities: { clipboard: canCopyGif(), worker: hasWorker() },
    conversions: {},
    copying: [],
    error: "",
    notice: "",
    pendingCopies: [],
    pendingDownloads: [],
    status: "idle",
    url: "",
  },
});

// An X gif is an mp4 wearing the flag: only it converts.
const without = (urls: readonly string[], url: string): string[] =>
  urls.filter((entry) => entry !== url);

const withUrl = (urls: readonly string[], url: string): string[] =>
  urls.includes(url) ? [...urls] : [...urls, url];

const conversionOf = (model: Model, videoUrl: string) =>
  model.conversions[videoUrl];

// The download name mirrors download-link's stem so the saved gif matches
// the mp4's name exactly, with the gif container.
const gifFilename = (model: Model, videoUrl: string): string => {
  const index = model.assets.findIndex((asset) => asset.videoUrl === videoUrl);
  const asset = model.assets[index];

  if (!asset) {
    return "video.gif";
  }

  const tag = asset.label ?? String(index + 1);

  const stem =
    model.assets.length > 1
      ? `${asset.platform}-${asset.shortcode}-${tag}`
      : `${asset.platform}-${asset.shortcode}`;

  return `${stem}.gif`;
};

// One place answers a resolved list, whether it came from the network or the
// cache: prune conversions the new list dropped, prefetch the gif work the
// kept list still lacks, and show the assets.
const applyResolved = (
  model: Model,
  assets: readonly Asset[]
): Update.Return<Model, Message> => {
  const urls = new Set(assets.map((asset) => asset.videoUrl));

  const kept = Object.fromEntries(
    Object.entries(model.conversions).filter(([videoUrl]) => urls.has(videoUrl))
  );

  const converts = assets.flatMap((asset) =>
    asset.gif === "video" &&
    model.capabilities.worker &&
    kept[asset.videoUrl] === undefined
      ? [
          ConvertGif({
            downloadHref: asset.downloadHref,
            videoUrl: asset.videoUrl,
          }),
        ]
      : []
  );

  const loading = { ...kept };

  for (const asset of assets) {
    if (
      asset.gif === "video" &&
      model.capabilities.worker &&
      loading[asset.videoUrl] === undefined
    ) {
      loading[asset.videoUrl] = GifConversion.Loading();
    }
  }

  return {
    commands: converts,
    model: modifyFields(model, {
      assets: () => [...assets],
      conversions: () => loading,
      error: () => "",
      notice: () => "",
      status: () => "ready",
    }),
  };
};

export const update = (
  model: Model,
  message: Message
): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    ChangedUrl: ({ value }) => ({
      model: modifyFields(model, { url: () => value }),
    }),
    ClickedCopyGif: ({ videoUrl }) => {
      const asset = model.assets.find((entry) => entry.videoUrl === videoUrl);

      if (!asset || asset.gif === undefined) {
        return { model };
      }

      if (model.copying.includes(videoUrl)) {
        return { model };
      }

      // a video gif copies its converted bytes: convert first when they are
      // not ready yet, then copy on success
      const conversion = conversionOf(model, videoUrl);

      if (asset.gif === "video" && conversion?._tag !== "Success") {
        const converting = conversion?._tag === "Loading";

        return {
          commands: converting
            ? []
            : [ConvertGif({ downloadHref: asset.downloadHref, videoUrl })],
          model: modifyFields(model, {
            conversions: () =>
              converting
                ? model.conversions
                : {
                    ...model.conversions,
                    [videoUrl]: GifConversion.Loading(),
                  },
            copying: (urls) => withUrl(urls, videoUrl),
            pendingCopies: (urls) => withUrl(urls, videoUrl),
          }),
        };
      }

      return {
        commands: [
          CopyGif({
            blob: conversion?._tag === "Success" ? conversion.data : undefined,
            downloadHref: asset.downloadHref,
            kind: asset.gif,
            videoUrl,
          }),
        ],
        model: modifyFields(model, {
          copying: (urls) => withUrl(urls, videoUrl),
        }),
      };
    },
    ClickedDownloadGif: ({ videoUrl }) => {
      const asset = model.assets.find((entry) => entry.videoUrl === videoUrl);

      if (!asset) {
        return { model };
      }

      const conversion = conversionOf(model, videoUrl);

      if (conversion?._tag === "Success") {
        return {
          commands: [
            SaveGif({
              blob: conversion.data,
              filename: gifFilename(model, videoUrl),
              videoUrl,
            }),
          ],
          model,
        };
      }

      if (conversion?._tag === "Loading") {
        return {
          model: modifyFields(model, {
            pendingDownloads: (urls) => withUrl(urls, videoUrl),
          }),
        };
      }

      return {
        commands: [ConvertGif({ downloadHref: asset.downloadHref, videoUrl })],
        model: modifyFields(model, {
          conversions: () => ({
            ...model.conversions,
            [videoUrl]: GifConversion.Loading(),
          }),
          pendingDownloads: (urls) => withUrl(urls, videoUrl),
        }),
      };
    },
    CompletedGoDownload: () => ({ model }),
    CompletedSaveGif: () => ({ model }),
    FailedConvertGif: ({ videoUrl }) => {
      const asset = model.assets.find((entry) => entry.videoUrl === videoUrl);

      if (model.pendingDownloads.includes(videoUrl) && asset) {
        return {
          commands: [GoDownload({ href: asset.downloadHref, videoUrl })],
          model: modifyFields(model, {
            conversions: () => ({
              ...model.conversions,
              [videoUrl]: GifConversion.Failure({
                error: "Conversion failed, getting the original instead.",
              }),
            }),
            notice: () => "Conversion failed, getting the original instead.",
            pendingDownloads: (urls) => without(urls, videoUrl),
          }),
        };
      }

      return {
        model: modifyFields(model, {
          conversions: () => ({
            ...model.conversions,
            [videoUrl]: GifConversion.Failure({
              error: "Conversion failed.",
            }),
          }),
          pendingCopies: (urls) => without(urls, videoUrl),
        }),
      };
    },
    FailedCopyGif: ({ videoUrl }) => ({
      model: modifyFields(model, {
        copying: (urls) => without(urls, videoUrl),
        notice: () => "Copy failed — download the file instead.",
        pendingCopies: (urls) => without(urls, videoUrl),
      }),
    }),
    FailedResolve: ({ error }) => ({
      model: modifyFields(model, {
        assets: () => [],
        error: () => error,
        notice: () => "",
        status: () => "failed",
      }),
    }),
    SubmittedForm: () => {
      const url = model.url.trim();

      if (!url) {
        return {
          model: modifyFields(model, {
            assets: () => [],
            error: () => EMPTY_LINK,
            notice: () => "",
            status: () => "failed",
          }),
        };
      }

      // a fresh answer for the same link skips the network; the clock read
      // decides, so update never depends on a clock it cannot observe
      if (model.recent?.url === url) {
        return {
          commands: [ReadClock({ url })],
          model: modifyFields(model, {
            error: () => "",
            notice: () => "",
          }),
        };
      }

      return {
        commands: [ResolveUrl({ url })],
        model: modifyFields(model, {
          error: () => "",
          notice: () => "",
          status: () => "loading",
        }),
      };
    },
    SucceededClock: ({ now, url }) => {
      const { recent } = model;

      if (recent && recent.url === url && now - recent.at < FRESH_MS) {
        return applyResolved(model, recent.assets);
      }

      return {
        commands: [ResolveUrl({ url })],
        model: modifyFields(model, { status: () => "loading" }),
      };
    },
    SucceededConvertGif: ({ blob, videoUrl }) => {
      const asset = model.assets.find((entry) => entry.videoUrl === videoUrl);

      if (!asset) {
        return { model };
      }

      const downloads = model.pendingDownloads.includes(videoUrl)
        ? [
            SaveGif({
              blob,
              filename: gifFilename(model, videoUrl),
              videoUrl,
            }),
          ]
        : [];

      const copies = model.pendingCopies.includes(videoUrl)
        ? [
            CopyGif({
              blob,
              downloadHref: asset.downloadHref,
              kind: asset.gif ?? "video",
              videoUrl,
            }),
          ]
        : [];

      return {
        commands: [...downloads, ...copies],
        model: modifyFields(model, {
          conversions: () => ({
            ...model.conversions,
            [videoUrl]: GifConversion.Success({ data: blob }),
          }),
          pendingCopies: (urls) => without(urls, videoUrl),
          pendingDownloads: (urls) => without(urls, videoUrl),
        }),
      };
    },
    SucceededCopyGif: ({ mode, videoUrl }) => ({
      model: modifyFields(model, {
        copying: (urls) => without(urls, videoUrl),
        notice: () =>
          mode === "gif"
            ? "Copied — paste it anywhere to share the GIF."
            : "Copied link — paste it anywhere to share the GIF.",
        pendingCopies: (urls) => without(urls, videoUrl),
      }),
    }),
    SucceededResolve: ({ assets, resolvedAt, url }) => {
      const applied = applyResolved(model, assets);

      return {
        ...applied,
        model: modifyFields(applied.model, {
          recent: () => ({ assets, at: resolvedAt, url }),
        }),
      };
    },
  });

// The media never overflows its row: 60vh keeps landscape videos width-bound
// on tall screens while shrinking portrait videos into the visible column.
const MEDIA_CLASS = "block max-h-[60vh] w-full object-contain";

const previewView = (h: HtmlBuilder<Message>, asset: Asset): Html => {
  if (asset.gif === "file") {
    return h.img([
      h.Src(asset.videoUrl),
      h.Alt("GIF preview"),
      h.Class(MEDIA_CLASS),
    ]);
  }

  if (asset.gif === "video") {
    return h.video(
      [
        h.Src(asset.videoUrl),
        h.Autoplay(true),
        h.Loop(true),
        h.Muted(true),
        h.Playsinline(true),
        h.Class(MEDIA_CLASS),
      ],
      []
    );
  }

  // YouTube mp4s are huge and gated: the thumbnail previews, the file downloads.
  if (asset.platform === "youtube" && asset.thumbnail !== undefined) {
    return h.img([
      h.Src(asset.thumbnail),
      h.Alt("Video thumbnail"),
      h.Class(MEDIA_CLASS),
    ]);
  }

  // The same container rule the download uses, so the preview cannot claim a
  // playlist is playable when the proxy names it a manifest.
  if (isManifestContainer(containerOf(asset.videoUrl))) {
    return h.p(
      [h.Class("text-left text-sm text-white/55")],
      [
        "This post serves a streaming playlist, which the player cannot preview. Download it to get the file.",
      ]
    );
  }

  const attrs = [h.Src(asset.videoUrl), h.Controls(true), h.Class(MEDIA_CLASS)];

  return h.video(
    asset.thumbnail === undefined
      ? attrs
      : [...attrs, h.Poster(asset.thumbnail)],
    []
  );
};

const downloadControl = (
  h: HtmlBuilder<Message>,
  model: Model,
  asset: Asset
): Html => {
  if (asset.gif !== "video") {
    return h.a(
      [
        h.Href(asset.downloadHref),
        h.Class(
          "text-left text-sm text-white/85 underline decoration-white/30 underline-offset-4"
        ),
      ],
      [`Download${asset.label === undefined ? "" : ` ${asset.label}`}`]
    );
  }

  const conversion = conversionOf(model, asset.videoUrl);

  const working =
    conversion?._tag === "Loading" ||
    model.pendingDownloads.includes(asset.videoUrl);

  return h.button(
    [
      h.Type("button"),
      h.OnClick(Message.ClickedDownloadGif({ videoUrl: asset.videoUrl })),
      h.Disabled(working),
      h.Class(
        "bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      ),
    ],
    [working ? "Making GIF…" : "Download GIF"]
  );
};

const copyControl = (
  h: HtmlBuilder<Message>,
  model: Model,
  asset: Asset
): Html => {
  if (asset.gif === undefined || !model.capabilities.clipboard) {
    return h.empty;
  }

  const copying = model.copying.includes(asset.videoUrl);

  return h.button(
    [
      h.Type("button"),
      h.OnClick(Message.ClickedCopyGif({ videoUrl: asset.videoUrl })),
      h.Disabled(copying),
      h.Class(
        "border border-white/15 px-4 py-2 text-sm text-white/85 disabled:opacity-50"
      ),
    ],
    [copying ? "Copying…" : "Copy GIF"]
  );
};

const assetView = (
  h: HtmlBuilder<Message>,
  model: Model,
  asset: Asset
): Html => {
  const heading = asset.title ?? asset.shortcode;

  const detail = [asset.platform, asset.shortcode, asset.label]
    .filter((part) => part !== undefined)
    .join(" · ");

  return h.li(
    [h.Class("flex flex-col gap-3 border-t border-white/10 pt-5")],
    [
      h.div(
        [h.Class("flex flex-col gap-1")],
        [
          h.p(
            [h.Class("text-left text-sm font-medium text-white/85")],
            [heading]
          ),
          h.p([h.Class("text-left text-xs text-white/45")], [detail]),
        ]
      ),
      previewView(h, asset),
      h.div(
        [h.Class("flex flex-row flex-wrap gap-3")],
        [downloadControl(h, model, asset), copyControl(h, model, asset)]
      ),
    ]
  );
};

const statusText = (model: Model): string => {
  if (model.notice !== "") {
    return model.notice;
  }

  if (model.status === "loading") {
    return "Fetching…";
  }

  if (model.status === "failed") {
    return `Could not fetch — ${model.error}`;
  }

  return "Paste a public video link. Fetch it, then download the file.";
};

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("min-h-dvh bg-[#0b0b0d] text-white/85")],
    [
      h.main(
        [
          h.Class(
            "mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-8 px-6 py-10 text-left md:px-10 md:py-20"
          ),
        ],
        [
          h.div(
            [h.Class("flex flex-col gap-6")],
            [
              h.h1(
                [
                  h.Class(
                    "text-left text-2xl font-medium tracking-tight text-white/90"
                  ),
                ],
                ["Video downloader"]
              ),
              h.form(
                [
                  h.OnSubmit(Message.SubmittedForm()),
                  h.Class("flex flex-col gap-2 sm:flex-row"),
                ],
                [
                  h.input([
                    h.Type("text"),
                    h.Name("url"),
                    h.Value(model.url),
                    h.OnInput((value) => Message.ChangedUrl({ value })),
                    h.Placeholder("Paste any video link"),
                    h.AriaLabel("Video link"),
                    h.Class(
                      "w-full border border-white/15 bg-white/5 px-3 py-2 text-white/85 placeholder:text-white/35 focus:border-white/40 focus:outline-none"
                    ),
                  ]),
                  h.button(
                    [
                      h.Type("submit"),
                      h.Disabled(model.status === "loading"),
                      h.Class(
                        "bg-white px-4 py-2 font-medium text-black disabled:opacity-50"
                      ),
                    ],
                    [model.status === "loading" ? "Fetching…" : "Fetch"]
                  ),
                ]
              ),
            ]
          ),
          h.p(
            [h.Role("status"), h.Class("text-left text-sm text-white/55")],
            [statusText(model)]
          ),
          model.status === "ready"
            ? h.ul(
                [h.Class("flex list-none flex-col gap-5 p-0")],
                model.assets.map((asset) => assetView(h, model, asset))
              )
            : h.empty,
        ]
      ),
    ]
  );

// The page-owning view: the same body, plus the document facts the runtime
// keeps in <head> (title, canonical, og:url). Static description and card tags
// live in index.html beside the mount point.
export const viewDocument = (
  model: Model,
  h: HtmlBuilder<Message>
): Document => ({
  body: view(model, h),
  canonical: "https://download.maharshi.work/",
  ogUrl: "https://download.maharshi.work/",
  title: "Video Downloader — Save Online Videos",
});
