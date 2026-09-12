import type { Route } from "./+types/home";
import { useFetcher } from "react-router";
import { Alert, Button, Card, Input } from "@heroui/react";
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
    <main className="min-h-screen flex flex-col items-center p-6">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div className="text-center flex flex-col gap-2 py-4">
          <h1 className="text-3xl font-bold">Insta Video Downloader</h1>
          <p className="text-sm text-muted">Paste a public Reel or Post URL — preview & save. No login.</p>
        </div>

        <Card>
          <Card.Header>
            <Card.Title>Paste Instagram URL</Card.Title>
            <Card.Description>Supports /reel/, /p/, /tv/ — public videos only.</Card.Description>
          </Card.Header>
          <Card.Content>
            <fetcher.Form method="post" className="flex flex-col gap-3">
              <Input
                name="url"
                aria-label="Instagram URL"
                placeholder="https://www.instagram.com/reel/..../"
                defaultValue={data?.inputUrl ?? ""}
                fullWidth
                required
              />
              <Button type="submit" isDisabled={isLoading} className="w-full">
                {isLoading ? "Fetching..." : "Fetch Video"}
              </Button>
            </fetcher.Form>
          </Card.Content>
        </Card>

        {error ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Could not fetch video</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {videoUrl ? (
          <Card>
            <Card.Header>
              <Card.Title>Preview</Card.Title>
              <Card.Description>Shortcode: {shortcode}</Card.Description>
            </Card.Header>
            <Card.Content>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={videoUrl} controls poster={data && "thumbnail" in data ? data.thumbnail : undefined} className="w-full rounded-2xl" />
            </Card.Content>
            <Card.Footer>
              <a href={downloadHref} className="w-full">
                <Button className="w-full">Download .mp4</Button>
              </a>
            </Card.Footer>
          </Card>
        ) : null}

        <Card variant="secondary">
          <Card.Content>
            <p className="text-xs text-muted leading-5">
              Disclaimer: Only download public content you have rights to. This tool does not store videos — it proxies the direct CDN URL for your browser to save. Respect Instagram’s Terms and creator copyright.
            </p>
          </Card.Content>
        </Card>
      </div>
    </main>
  );
}
