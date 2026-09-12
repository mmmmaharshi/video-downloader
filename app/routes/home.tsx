import type { Route } from "./+types/home";
import * as React from "react";
import { useFetcher } from "react-router";
import { Alert, Button, Input, Modal, Separator } from "@heroui/react";
import { extractVideoUrl } from "../lib/instagram.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Insta Downloader — Save public Reels & Posts" },
    { name: "description", content: "Paste a public Instagram reel or post URL to preview and download. No login, no storage." },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: "Paste an Instagram URL" } as const;
  try {
    const data = await extractVideoUrl(url);
    return { videoUrl: data.videoUrl, thumbnail: data.thumbnail, shortcode: data.shortcode, inputUrl: url } as const;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to extract video";
    return { error: msg, inputUrl: url } as const;
  }
}

type ActionData = { videoUrl: string; thumbnail?: string; shortcode: string; inputUrl: string; error?: never } | { error: string; inputUrl: string; videoUrl?: never };

export default function Home() {
  const fetcher = useFetcher<ActionData>();
  const data = fetcher.data;
  const isLoading = fetcher.state !== "idle";
  const videoUrl = data && "videoUrl" in data ? data.videoUrl : undefined;
  const error = data && "error" in data ? data.error : undefined;
  const shortcode = data && "shortcode" in data ? data.shortcode : undefined;

  const downloadHref = videoUrl ? `/api/download?url=${encodeURIComponent(videoUrl)}&code=${encodeURIComponent(shortcode ?? "video")}` : undefined;

  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    if (videoUrl) setIsOpen(true);
  }, [videoUrl]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-[720px] px-6 py-16 md:px-8 md:py-20">
        <div className="flex flex-col gap-6">
          <h1 className="text-[28px] font-medium leading-[1.1] tracking-[-0.02em] md:text-[32px]">Insta downloader</h1>

          <fetcher.Form method="post" className="flex flex-col gap-3 sm:flex-row">
            <Input
              name="url"
              aria-label="Instagram URL"
              placeholder="https://www.instagram.com/reel/.../"
              defaultValue={data?.inputUrl ?? ""}
              fullWidth
              required
            />
            <Button type="submit" isPending={isLoading} isDisabled={isLoading} className="sm:min-w-[140px] sm:shrink-0">
              {isLoading ? "Fetching…" : "Fetch"}
            </Button>
          </fetcher.Form>
        </div>

        {error ? (
          <div className="mt-8">
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Could not fetch</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          </div>
        ) : null}

        <Separator className="mt-12" />
        <p className="mt-6 max-w-[60ch] text-xs leading-5 text-muted">
          Only download content you have rights to. No storage — direct CDN proxy. Respect Instagram&apos;s terms.
        </p>
      </main>

      <Modal.Backdrop isOpen={isOpen} onOpenChange={setIsOpen}>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Preview</Modal.Heading>
              {shortcode ? <p className="text-xs text-muted">{shortcode}</p> : null}
            </Modal.Header>
            <Modal.Body className="p-0">
              {videoUrl ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={videoUrl}
                  controls
                  poster={data && "thumbnail" in data ? data.thumbnail : undefined}
                  className="w-full bg-surface-secondary object-cover"
                />
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" slot="close">
                Close
              </Button>
              {downloadHref ? (
                <a href={downloadHref}>
                  <Button>Download .mp4</Button>
                </a>
              ) : null}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
