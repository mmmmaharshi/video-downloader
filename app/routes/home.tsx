import {
  Button,
  Input,
  ListBox,
  Modal,
  Select,
  Spinner,
  TextField,
  Toast,
  Typography,
  toast,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { containerOf, isManifestContainer } from "../lib/container";
import type { VideoAsset } from "../lib/media-resolver";
import { blobToDataUrl, convertMp4ToGif } from "../lib/mp4-to-gif";
import type { ClipboardReps } from "../lib/mp4-to-gif";
import { closedPreview, nextPreview } from "../lib/preview";
import type { PreviewState } from "../lib/preview";
import {
  isFresh,
  resolveKey,
  resolveResultSchema,
  stemOf,
} from "../lib/resolve-query";
import type { ResolveResult, ResolvedAsset } from "../lib/resolve-query";
import type { Route } from "./+types/home";

export const meta = () => [
  { title: "Video Downloader — Save Online Videos" },
  {
    content: "Paste any public video link to download. No login, no storage.",
    name: "description",
  },
  { content: "https://download.maharshi.work/", property: "og:url" },
  { content: "Video Downloader — Save Online Videos", property: "og:title" },
  {
    content: "Paste any public video link to download. No login, no storage.",
    property: "og:description",
  },
  { content: "website", property: "og:type" },
  { content: "https://download.maharshi.work/og.png", property: "og:image" },
  { content: "summary_large_image", name: "twitter:card" },
  { content: "https://download.maharshi.work/og.png", name: "twitter:image" },
  { content: "Video Downloader — Save Online Videos", name: "twitter:title" },
  {
    content: "Paste any public video link to download. No login, no storage.",
    name: "twitter:description",
  },
];

export const links: Route.LinksFunction = () => [
  { href: "https://download.maharshi.work/", rel: "canonical" },
];

// The media never overflows the dialog: 70vh keeps landscape videos width-bound
// on tall screens, while 100dvh minus the header/footer/dialog chrome (~300px)
// shrinks portrait videos into the visible body instead of scrolling it.
const MEDIA_CLASS =
  "block w-full max-h-[min(70vh,calc(100dvh-300px))] object-contain";

// the resolver flags what it served as gif; the path covers og:video links
// from other resolvers, which never see a content-type
const isGifAsset = (asset: VideoAsset): boolean =>
  asset.gif === true || containerOf(asset.videoUrl) === "gif";

// only a real gif file can go on the clipboard as bytes — an X mp4 cannot,
// so it skips the fetch and copies its link at once
const isGifFile = (asset: VideoAsset): boolean =>
  containerOf(asset.videoUrl) === "gif";

// only a non-file gif needs converting: a real gif file downloads as-is
const needsConverting = (asset: VideoAsset): boolean =>
  asset.gif === true && !isGifFile(asset);

const PreviewMedia = ({ asset }: { asset: VideoAsset }) => {
  // a real gif file animates in an image element; an X gif is an mp4, which
  // plays in a video element — autoplaying and looping, like a gif
  if (containerOf(asset.videoUrl) === "gif") {
    return (
      <img src={asset.videoUrl} alt="GIF preview" className={MEDIA_CLASS} />
    );
  }

  if (asset.gif === true) {
    return (
      <video
        src={asset.videoUrl}
        autoPlay
        loop
        muted
        playsInline
        className={MEDIA_CLASS}
      />
    );
  }

  // the same container rule the download uses, so the preview cannot call a
  // file playable that the proxy names as a playlist
  return isManifestContainer(containerOf(asset.videoUrl)) ? (
    <Typography color="muted" type="body-sm">
      This post serves a streaming playlist, which the player cannot preview.
      Download it to get the file.
    </Typography>
  ) : (
    // remote posts ship no caption track — a placeholder <track> would claim accessibility that does not exist
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={asset.videoUrl}
      controls
      poster={asset.thumbnail}
      className={MEDIA_CLASS}
    />
  );
};

// one copy, every app gets its best form: bytes where the clipboard takes
// them, an html image for rich-text apps, the link for chats (which unfurl it)
const gifReps = async (asset: ResolvedAsset): Promise<ClipboardReps> => {
  // an X gif has no gif file to point an <img> at: link only
  if (!isGifFile(asset)) {
    return { "text/plain": asset.videoUrl };
  }

  // the url comes from a remote page: keep it inside the attribute
  const html = `<img src="${asset.videoUrl.replaceAll('"', "%22")}" alt="GIF">`;

  if (ClipboardItem.supports?.("image/gif")) {
    const res = await fetch(asset.downloadHref);

    if (!res.ok) {
      throw new Error(`downloadHref returned ${res.status}`);
    }

    return {
      "image/gif": await res.blob(),
      "text/html": html,
      "text/plain": asset.videoUrl,
    };
  }

  return { "text/html": html, "text/plain": asset.videoUrl };
};

// the signed download href is same-origin, so this fetch dodges the
// cross-origin limits that block reading the file from its host
const copyLinkFallback = async (asset: ResolvedAsset): Promise<void> => {
  try {
    await navigator.clipboard.writeText(asset.videoUrl);
    toast.success("Copied link", {
      description: "Paste it anywhere to share the GIF.",
    });
  } catch {
    toast.danger("Copy failed", {
      description: "Download the file instead.",
    });
  }
};

const Home = () => {
  const queryClient = useQueryClient();
  const [preview, setPreview] = React.useState<PreviewState>(closedPreview);
  const [converting, setConverting] = React.useState(false);
  const [copying, setCopying] = React.useState(false);

  // One transition per resolved submit, whether the answer came from the
  // network or the cache. A fresh object per submit keeps repeat submits of
  // the same link reopening the preview.
  const applyResult = (result: ResolveResult) => {
    if ("error" in result) {
      setPreview((p) => nextPreview(p, { type: "failed" }));
      toast.danger("Could not fetch", { description: result.error });
    } else {
      setPreview((p) =>
        nextPreview(p, { assets: result.assets, type: "resolved" })
      );
    }
  };

  const mutation = useMutation({
    mutationFn: async (url: string): Promise<ResolveResult> => {
      const form = new FormData();
      form.set("url", url);
      const res = await fetch("/api/resolve", { body: form, method: "POST" });
      const result = resolveResultSchema.parse(await res.json());

      return result;
    },
    onError: () => {
      applyResult({
        error: "Network error. Check your connection and try again.",
      });
    },
    onSuccess: (result, url) => {
      // errors stay uncached so a transient failure never blocks retries;
      // only downloadable results are worth re-serving
      if ("assets" in result) {
        queryClient.setQueryData(resolveKey(url), result);
      }

      applyResult(result);
    },
  });

  const isLoading = mutation.isPending;

  // A fresh resolution stays cached inside the download gate window, so
  // re-submits skip the network without risking an expired download.
  // The pending guard stops double submits (Enter plus click, double click)
  // from firing duplicate mutations and toasts.
  const submit = (url: string) => {
    if (mutation.isPending) {
      return;
    }

    // an empty field is answered here rather than by the action, so no round
    // trip and no spinner; the message mirrors resolve() in media-resolver
    if (!url.trim()) {
      applyResult({ error: "Paste a video link" });

      return;
    }

    const key = resolveKey(url);
    const state = queryClient.getQueryState(key);
    // the query only ever holds what onSuccess cached: a ResolveResult
    const cached = queryClient.getQueryData<ResolveResult>(key);

    if (cached && state?.dataUpdatedAt && isFresh(state.dataUpdatedAt)) {
      applyResult(cached);
    } else {
      mutation.mutate(url);
    }
  };

  // The preview renders the assets that opened it, not whatever the latest result holds.
  const { shown } = preview;
  const current = shown[preview.active];
  const isYouTube = current?.platform === "youtube";

  const isGif = current !== undefined && isGifAsset(current);

  const dismiss = () =>
    setPreview((p) => nextPreview(p, { type: "dismissed" }));

  const select = (index: number) =>
    setPreview((p) => nextPreview(p, { index, type: "selected" }));

  // an X gif is an mp4 wearing the flag: download a converted gif file, not the mp4
  const downloadConvertedGif = async (asset: ResolvedAsset) => {
    const stem = stemOf(asset.downloadHref);

    setConverting(true);

    try {
      const blob = await convertMp4ToGif(asset.downloadHref);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${stem}.gif`;
      // some browsers only honor clicks on attached nodes; revoke late so
      // the download can grab the blob first
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      toast.success("Saved", {
        description: "The GIF is in your downloads.",
      });
    } catch (error) {
      // the mp4 always downloads: convert failure must not strand the file
      console.error("convert gif failed:", error);
      toast.success("Downloading MP4", {
        description: "Conversion failed, getting the original instead.",
      });
      window.location.href = asset.downloadHref;
    }

    setConverting(false);
  };

  const download = async (index: number) => {
    const asset = shown[index];

    if (!asset) {
      return;
    }

    if (needsConverting(asset)) {
      await downloadConvertedGif(asset);

      return;
    }

    if (asset.downloadHref) {
      window.location.href = asset.downloadHref;
    }
  };

  // an X gif is an mp4: convert it, then copy the gif inline as a data url
  // so the paste target gets real gif bytes instead of a link
  const copyGif = async (asset: ResolvedAsset) => {
    if (!needsConverting(asset)) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem(await gifReps(asset)),
        ]);
        toast.success("Copied", {
          description: "Paste it anywhere — chats and mail show the GIF.",
        });
      } catch {
        await copyLinkFallback(asset);
      }

      return;
    }

    setCopying(true);

    try {
      const blob = await convertMp4ToGif(asset.downloadHref);
      const dataUrl = await blobToDataUrl(blob);

      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": `<img src="${dataUrl}" alt="GIF">`,
          "text/plain": asset.videoUrl,
        }),
      ]);
      toast.success("Copied", {
        description: "Paste it anywhere — chats and mail show the GIF.",
      });
    } catch (error) {
      // silent here means undebuggable there: the toast stays plain so the
      // log carries the reason
      console.error("copy gif failed:", error);
      await copyLinkFallback(asset);
    }

    setCopying(false);
  };

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center gap-8 px-6 py-10 md:px-10 md:py-20">
        <div className="flex flex-col gap-6">
          <Typography type="h1">Video downloader</Typography>

          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              submit(
                new FormData(e.currentTarget).get("url")?.toString() ?? ""
              );
            }}
          >
            <TextField
              aria-label="Video link"
              fullWidth
              isRequired
              name="url"
              // aria validation keeps the native bubble out of it: submit()
              // rejects an empty field as a toast, like every other failure
              validationBehavior="aria"
            >
              <Input autoComplete="off" placeholder="Paste any video link" />
            </TextField>
            <Button
              className="w-full sm:w-auto"
              isDisabled={isLoading}
              isPending={isLoading}
              type="submit"
              variant="primary"
            >
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  {isPending ? "Fetching…" : "Fetch"}
                </>
              )}
            </Button>
          </form>
        </div>

        <Typography color="muted">
          Paste any video link and hit Fetch to download it from Instagram, X
          (Twitter), YouTube, Facebook, Reddit, Streamable, Vimeo, TikTok,
          Threads, Dailymotion, Loom, and direct video links.
        </Typography>
      </main>

      <Toast.Provider />
      <Modal
        isOpen={preview.open && current !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            dismiss();
          }
        }}
      >
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog aria-label="Video preview">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Preview</Modal.Heading>
                {current ? (
                  <Typography color="muted" type="body-sm">
                    {current.title ?? current.shortcode}
                  </Typography>
                ) : null}
              </Modal.Header>
              <Modal.Body>
                {/* YouTube previews stay a thumbnail: its mp4s are huge and gated, the file is what downloads */}
                {isYouTube && current && (
                  <img
                    src={current.thumbnail}
                    alt="Video thumbnail"
                    className={MEDIA_CLASS}
                  />
                )}
                {!isYouTube && current && <PreviewMedia asset={current} />}
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Close
                </Button>
                {shown.length > 1 && (
                  <Select
                    aria-label="Video options"
                    variant="secondary"
                    selectedKey={String(preview.active)}
                    onSelectionChange={(key) => select(Number(key))}
                  >
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {shown.map((a, i) => (
                          <ListBox.Item
                            key={i}
                            id={String(i)}
                            textValue={a.label ?? `Video ${i + 1}`}
                          >
                            {a.label ?? `Video ${i + 1}`}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                )}
                <Button
                  variant="primary"
                  isDisabled={converting}
                  isPending={converting}
                  onPress={() => download(preview.active)}
                >
                  {({ isPending }) => (
                    <>
                      {isPending ? <Spinner color="current" size="sm" /> : null}
                      {isPending ? "Making GIF…" : "Download"}
                    </>
                  )}
                </Button>
                {isGif && current && (
                  <Button
                    variant="secondary"
                    isDisabled={copying}
                    isPending={copying}
                    onPress={() => copyGif(current)}
                  >
                    {({ isPending }) => (
                      <>
                        {isPending ? (
                          <Spinner color="current" size="sm" />
                        ) : null}
                        {isPending ? "Copying…" : "Copy GIF"}
                      </>
                    )}
                  </Button>
                )}
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
};

export default Home;
