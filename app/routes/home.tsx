import type { Route } from "./+types/home";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { closedPreview, nextPreview, type PreviewState } from "../lib/preview";
import { toDownloadHref } from "../lib/download-link";
import { isFresh, resolveKey, type ResolveResult } from "../lib/resolve-query";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Video Downloader — Save Online Videos" },
    { name: "description", content: "Paste any public video link to download. No login, no storage." },
  ];
}

// The media never overflows the dialog: 70vh keeps landscape videos width-bound
// on tall screens, while 100dvh minus the header/footer/dialog chrome (~300px)
// shrinks portrait videos into the visible body instead of scrolling it.
const MEDIA_CLASS = "block w-full max-h-[min(70vh,calc(100dvh-300px))] object-contain";

export default function Home() {
  const queryClient = useQueryClient();
  const [data, setData] = React.useState<ResolveResult | undefined>();
  const mutation = useMutation({
    mutationFn: async (url: string): Promise<ResolveResult> => {
      const form = new FormData();
      form.set("url", url);
      const res = await fetch("/api/resolve", { method: "POST", body: form });
      return (await res.json()) as ResolveResult;
    },
    onSuccess: (result, url) => {
      queryClient.setQueryData(resolveKey(url), result);
      // a fresh object per submit so the effect below refires even for
      // repeat submits of the same link
      setData({ ...result });
    },
    onError: (_e, url) => {
      setData({ error: "Network error. Check your connection and try again.", inputUrl: url });
    },
  });
  const isLoading = mutation.isPending;

  // A fresh resolution stays cached inside the download gate window, so
  // re-submits skip the network without risking an expired download.
  const submit = (url: string) => {
    const key = resolveKey(url);
    const state = queryClient.getQueryState(key);
    const cached = state?.data as ResolveResult | undefined;
    if (cached && state?.dataUpdatedAt && isFresh(state.dataUpdatedAt)) {
      setData({ ...cached });
    } else {
      mutation.mutate(url);
    }
  };

  const [preview, setPreview] = React.useState<PreviewState>(closedPreview);

  // The preview renders the assets that opened it, not whatever the latest result holds.
  const shown = preview.shown;
  const current = shown[preview.active];
  const isYouTube = current?.platform === "youtube";

  React.useEffect(() => {
    if (!data) return;
    if ("error" in data) {
      setPreview((p) => nextPreview(p, { type: "failed" }));
      toast.danger("Could not fetch", { description: data.error });
    } else {
      setPreview((p) => nextPreview(p, { type: "resolved", assets: data.assets }));
    }
    // depends on the response, not the url inside it: re-fetching the same link resolves to an
    // equal url and must still reopen the preview
  }, [data]);

  const dismiss = () => setPreview((p) => nextPreview(p, { type: "dismissed" }));
  const select = (index: number) => setPreview((p) => nextPreview(p, { type: "selected", index }));
  const download = (index: number) => {
    window.location.href = toDownloadHref(shown, index);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center gap-8 px-6 py-10 md:px-10 md:py-20">
        <div className="flex flex-col gap-6">
          <Typography type="h1">Video downloader</Typography>

          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              submit(new FormData(e.currentTarget).get("url")?.toString() ?? "");
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
            <Button isDisabled={isLoading} isPending={isLoading} type="submit" variant="primary">
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
          Paste any video link and hit Fetch to download it from Instagram, Facebook, X
          (Twitter), or YouTube.
        </Typography>
      </main>

      <Toast.Provider />
      <Modal
        isOpen={preview.open && current !== undefined}
        onOpenChange={(open) => {
          if (!open) dismiss();
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
                {isYouTube && current ? (
                  <img src={current.thumbnail} alt="Video thumbnail" className={MEDIA_CLASS} />
                ) : current ? (
                  <video src={current.videoUrl} controls poster={current.thumbnail} className={MEDIA_CLASS} />
                ) : null}
                {shown.length > 1 && !isYouTube ? (
                  <div role="group" aria-label="Videos in this post" className="flex items-center gap-2">
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
                  </div>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Close
                </Button>
                {isYouTube ? (
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
                            <ListBox.Item key={i} id={String(i)} textValue={a.label ?? `Video ${i + 1}`}>
                              {a.label ?? `Video ${i + 1}`}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Button variant="primary" onPress={() => download(preview.active)}>
                      Download .mp4
                    </Button>
                  </>
                ) : shown.length === 1 ? (
                  <Button variant="primary" onPress={() => download(0)}>
                    Download .mp4
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2">
                    {shown.map((a, i) => (
                      <Button key={i} variant="primary" onPress={() => download(i)}>
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
}
