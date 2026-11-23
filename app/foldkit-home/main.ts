// Module: FoldkitHome — the home view as a Foldkit program.
// Model, verb-first Messages, exhaustive update, view, and Commands. The
// Schema-typed boundary is the /api/resolve response, validated with the
// shared Schema contract.
// shortcut: no cached re-serve (resolveKey/isFresh) and no GIF convert/copy
// flows yet — each submit fetches, and every rendition offers a Download link.

import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import type { Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";

import { containerOf, isManifestContainer } from "../lib/container";
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

// eslint-disable-next-line no-redeclare -- Foldkit documents the Schema value and its Type alias under one name
export const Model = Schema.Struct({
  assets: Schema.Array(Asset),
  error: Schema.String,
  status: Schema.Literals(["idle", "loading", "ready", "failed"]),
  url: Schema.String,
});

export type Model = typeof Model.Type;

// eslint-disable-next-line no-redeclare -- Foldkit documents the Schema value and its Type alias under one name
export const Message = defineMessageUnion({
  ChangedUrl: { value: Schema.String },
  FailedResolve: { error: Schema.String },
  SubmittedForm: {},
  SucceededResolve: { assets: Schema.Array(Asset) },
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

      return Message.SucceededResolve({ assets: decoded.assets });
    }).pipe(
      Effect.orElseSucceed(() =>
        Message.FailedResolve({ error: NETWORK_ERROR })
      )
    ),
  messages: [Message.SucceededResolve, Message.FailedResolve],
});

export const init = (): Update.Return<Model, Message> => ({
  model: { assets: [], error: "", status: "idle", url: "" },
});

export const update = (
  model: Model,
  message: Message
): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    ChangedUrl: ({ value }) => ({
      model: modifyFields(model, { url: () => value }),
    }),
    FailedResolve: ({ error }) => ({
      model: modifyFields(model, {
        assets: () => [],
        error: () => error,
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
            status: () => "failed",
          }),
        };
      }

      return {
        commands: [ResolveUrl({ url })],
        model: modifyFields(model, {
          error: () => "",
          status: () => "loading",
        }),
      };
    },
    SucceededResolve: ({ assets }) => ({
      model: modifyFields(model, {
        assets: () => assets,
        error: () => "",
        status: () => "ready",
      }),
    }),
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

const assetView = (h: HtmlBuilder<Message>, asset: Asset): Html => {
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
      h.a(
        [
          h.Href(asset.downloadHref),
          h.Class(
            "text-left text-sm text-white/85 underline decoration-white/30 underline-offset-4"
          ),
        ],
        [`Download${asset.label === undefined ? "" : ` ${asset.label}`}`]
      ),
    ]
  );
};

const statusText = (model: Model): string => {
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
                model.assets.map((asset) => assetView(h, asset))
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
