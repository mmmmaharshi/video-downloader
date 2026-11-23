// Module: FoldkitHomeView — the whole rendered surface of the home widget.
// Pure: it reads the Model and returns Html, so the program module stays about
// state and the view can be read on its own.

import type { Html, HtmlBuilder, Document } from "foldkit/html";

import { containerOf, isManifestContainer } from "../lib/container";
import { SITE_TITLE, SITE_URL } from "../lib/site";
import { conversionOf, Message } from "./main";
import type { Asset, Model } from "./main";

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
  canonical: SITE_URL,
  ogUrl: SITE_URL,
  title: SITE_TITLE,
});
