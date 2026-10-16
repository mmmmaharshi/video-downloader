import type { Route } from "./+types/home";
import * as React from "react";
import { useFetcher } from "react-router";
import {
  Alert,
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
  TextField,
  Typography,
} from "@heroui/react";
import { resolve, type VideoAsset } from "../lib/media-resolver";
import { closedPreview, nextPreview, type PreviewState } from "../lib/preview";
import { toDownloadHref } from "../lib/download-link";
import { rememberResolved } from "../lib/recent-resolves";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Video Downloader — Save Online Videos" },
    { name: "description", content: "Paste a public Instagram, X, or YouTube URL to preview and download. No login, no storage." },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const url = String(formData.get("url") ?? "").trim();
  try {
    const assets = await resolve(url);
    for (const a of assets) rememberResolved(a.videoUrl);
    return { assets, inputUrl: url } as const;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to extract video";
    return { error: msg, inputUrl: url } as const;
  }
}

type ActionData =
  | { assets: VideoAsset[]; inputUrl: string; error?: never }
  | { error: string; inputUrl: string; assets?: never };

// The media box never grows past the viewport: landscape videos stay width-bound
// while portrait ones clamp and letterbox instead of pushing the modal off-screen.
const MEDIA_CLASS = "block w-full max-h-[70vh] object-contain";

export default function Home() {
  const fetcher = useFetcher<ActionData>();
  const data = fetcher.data;
  const isLoading = fetcher.state !== "idle";
  const error = data && "error" in data ? data.error : undefined;

  const [preview, setPreview] = React.useState<PreviewState>(closedPreview);

  // The preview renders the assets that opened it, not whatever the fetcher holds now.
  const shown = preview.shown;
  const current = shown[preview.active];
  const isYouTube = current?.platform === "youtube";

  React.useEffect(() => {
    if (!data) return;
    if ("error" in data) {
      setPreview((p) => nextPreview(p, { type: "failed" }));
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
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center gap-8 px-6 py-10 md:px-8 md:py-20">
        <div className="flex flex-col gap-6">
          <Typography type="h1">Video downloader</Typography>

          <fetcher.Form method="post" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <TextField
              aria-label="Instagram, X, or YouTube video URL"
              defaultValue={data?.inputUrl ?? ""}
              fullWidth
              isRequired
              name="url"
            >
              <Input autoComplete="off" placeholder="Paste an Instagram, X, or YouTube video URL" />
            </TextField>
            <Button isDisabled={isLoading} type="submit" variant="primary">
              {isLoading ? (
                <>
                  <Spinner size="sm" />
                  Fetching&hellip;
                </>
              ) : (
                "Fetch"
              )}
            </Button>
          </fetcher.Form>
        </div>

        {error ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Could not fetch</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <Typography color="muted">
          Only download content you have rights to. No storage &mdash; direct CDN proxy. Respect
          Instagram&apos;s, X&apos;s, and YouTube&apos;s terms.
        </Typography>
      </main>

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
                    {current.shortcode}
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
                      selectedKey={String(preview.active)}
                      onSelectionChange={(key) => select(Number(key))}
                    >
                      <Label>Quality</Label>
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
