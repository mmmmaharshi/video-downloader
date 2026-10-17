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

import { toDownloadHref } from "../lib/download-link";
import { closedPreview, nextPreview } from "../lib/preview";
import type { PreviewState } from "../lib/preview";
import { isFresh, resolveKey, resolveResultSchema } from "../lib/resolve-query";
import type { ResolveResult } from "../lib/resolve-query";
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

const Home = () => {
  const queryClient = useQueryClient();
  const [data, setData] = React.useState<ResolveResult | undefined>();
  const [preview, setPreview] = React.useState<PreviewState>(closedPreview);

  // One transition per resolved submit, whether the answer came from the
  // network or the cache. A fresh object per submit keeps repeat submits of
  // the same link reopening the preview.
  const applyResult = (result: ResolveResult) => {
    setData({ ...result });

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
    onError: (_e, url) => {
      applyResult({
        error: "Network error. Check your connection and try again.",
        inputUrl: url,
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

  const dismiss = () =>
    setPreview((p) => nextPreview(p, { type: "dismissed" }));

  const select = (index: number) =>
    setPreview((p) => nextPreview(p, { index, type: "selected" }));

  const download = (index: number) => {
    window.location.href = toDownloadHref(shown, index);
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
              defaultValue={data?.inputUrl ?? ""}
              fullWidth
              isRequired
              name="url"
              // aria validation lets empty submits reach the action, so the
              // failure surfaces as a toast instead of a native bubble
              validationBehavior="aria"
            >
              <Input autoComplete="off" placeholder="Paste any video link" />
            </TextField>
            <Button
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
                {!isYouTube && current && (
                  // remote posts ship no caption track — a placeholder <track> would claim accessibility that does not exist
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={current.videoUrl}
                    controls
                    poster={current.thumbnail}
                    className={MEDIA_CLASS}
                  />
                )}
                {shown.length > 1 && !isYouTube ? (
                  // fieldset is the native group element; preflight strips its chrome
                  <fieldset
                    aria-label="Videos in this post"
                    className="flex items-center gap-2"
                  >
                    {shown.map((a, i) => (
                      <Button
                        key={i}
                        aria-label={`Show video ${i + 1}`}
                        aria-current={i === preview.active}
                        size="sm"
                        variant={i === preview.active ? "primary" : "secondary"}
                        onPress={() => select(i)}
                      >
                        {a.label ?? i + 1}
                      </Button>
                    ))}
                  </fieldset>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Close
                </Button>
                {isYouTube && (
                  <>
                    <Select
                      aria-label="Video quality"
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
                    <Button
                      variant="primary"
                      onPress={() => download(preview.active)}
                    >
                      Download
                    </Button>
                  </>
                )}
                {!isYouTube && shown.length === 1 && (
                  <Button variant="primary" onPress={() => download(0)}>
                    Download
                  </Button>
                )}
                {!isYouTube && shown.length > 1 && (
                  <div className="flex flex-col gap-2">
                    {shown.map((a, i) => (
                      <Button
                        key={i}
                        variant="primary"
                        onPress={() => download(i)}
                      >
                        Download {a.label ?? `video ${i + 1}`}
                      </Button>
                    ))}
                  </div>
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
