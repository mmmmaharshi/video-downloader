import type { Route } from "./+types/home";
import { useFetcher } from "react-router";
import { Alert, Button, Card, Input, Separator } from "@heroui/react";
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-[720px] px-6 py-16 md:px-8 md:py-20">
        {/* Primary task — minimal */}
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

        {videoUrl ? (
          <>
            <Separator className="mt-10" />
            <div className="mt-10">
              <Card className="overflow-hidden">
                <Card.Content className="p-0">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    src={videoUrl}
                    controls
                    poster={data && "thumbnail" in data ? data.thumbnail : undefined}
                    className="w-full bg-surface-secondary object-cover"
                  />
                </Card.Content>
                <Card.Footer className="flex items-center justify-between gap-4 border-t border-separator p-3">
                  <span className="text-xs text-muted">{shortcode}</span>
                  <a href={downloadHref}>
                    <Button size="sm">Download .mp4</Button>
                  </a>
                </Card.Footer>
              </Card>
            </div>
          </>
        ) : null}

        <Separator className="mt-12" />
        <p className="mt-6 max-w-[60ch] text-xs leading-5 text-muted">
          Only download content you have rights to. No storage — direct CDN proxy. Respect Instagram&apos;s terms.
        </p>
      </main>
    </div>
  );
}
