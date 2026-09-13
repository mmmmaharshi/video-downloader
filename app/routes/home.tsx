import type { Route } from "./+types/home";
import * as React from "react";
import { useFetcher } from "react-router";
import { resolve } from "../lib/media-resolver";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Video Downloader — Save Online Videos" },
    { name: "description", content: "Paste a public Instagram reel or post URL to preview and download. No login, no storage." },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: "Paste an Instagram URL" } as const;
  try {
    const data = await resolve(url);
    return { videoUrl: data.videoUrl, thumbnail: data.thumbnail, shortcode: data.shortcode, inputUrl: url } as const;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to extract video";
    return { error: msg, inputUrl: url } as const;
  }
}

type ActionData =
  | { videoUrl: string; thumbnail?: string; shortcode: string; inputUrl: string; error?: never }
  | { error: string; inputUrl: string; videoUrl?: never };

export default function Home() {
  const fetcher = useFetcher<ActionData>();
  const data = fetcher.data;
  const isLoading = fetcher.state !== "idle";
  const videoUrl = data && "videoUrl" in data ? data.videoUrl : undefined;
  const error = data && "error" in data ? data.error : undefined;
  const shortcode = data && "shortcode" in data ? data.shortcode : undefined;

  const downloadHref = videoUrl
    ? `/api/download?url=${encodeURIComponent(videoUrl)}&code=${encodeURIComponent(shortcode ?? "video")}`
    : undefined;

  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    if (videoUrl) setIsOpen(true);
  }, [videoUrl]);

  // Close on backdrop click or Escape key
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) setIsOpen(false);
  };

  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Prevent body scroll when modal is open
  React.useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <div className="flex min-h-dvh flex-col bg-[color:var(--sc-background)] text-[color:var(--foreground)]">
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center gap-8 px-6 py-10 md:px-8 md:py-20">
        <div className="flex flex-col gap-6">
          <h1 className="text-[28px] font-medium leading-[1.1] tracking-tight md:text-[32px]" style={{ letterSpacing: "-0.02em" }}>
            Video downloader
          </h1>

          <fetcher.Form method="post" className="flex flex-col gap-3 sm:flex-row">
            <input
              name="url"
              aria-label="Instagram URL"
              placeholder="https://www.instagram.com/reel/.../"
              defaultValue={data?.inputUrl ?? ""}
              autoComplete="off"
              required
              className="h-[44px] flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--sc-surface)] px-4 text-[15px] leading-[1.45] text-[color:var(--foreground)] placeholder:[color:var(--sc-tertiary)] outline-none transition-all duration-[150ms] ease-out focus-visible:border-[color:var(--foreground)] focus-visible:ring-2 focus-visible:ring-[color:var(--foreground)]/20 hover:bg-[color:rgba(255,255,255,0.06)] sm:w-auto sm:min-w-[280px]"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="group flex h-[44px] items-center justify-center rounded-md bg-[color:var(--foreground)] px-6 text-[15px] font-medium leading-[1.4] text-[#0a0a0a] transition-all duration-[150ms] ease-out hover:bg-[color:rgb(255_255_255/_90%)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 sm:w-auto sm:min-w-[140px]"
            >
              {isLoading ? "Fetching\u2026" : "Fetch"}
            </button>
          </fetcher.Form>
        </div>

        {error ? (
          <div className="rounded-md border border-red-500/[0.2] bg-red-500/[0.08] p-4">
            <div className="flex items-start gap-3">
              <svg
                className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>
                <p className="text-sm font-medium text-[color:var(--foreground)]">Could not fetch</p>
                <p className="mt-1 text-sm leading-5 text-[color:var(--secondary)]">{error}</p>
              </div>
            </div>
          </div>
        ) : null}

        <hr className="border-0 border-t border-[color:var(--border)]" />
        <p className="max-w-[68ch] text-[15px] leading-6 text-[color:var(--secondary)]">
          Only download content you have rights to. No storage &mdash; direct CDN proxy. Respect Instagram&apos;s terms.
        </p>
      </main>

      {/* Modal */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Video preview"
          onClick={handleBackdropClick}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgb(0_0_0/_56%)] p-6 transition-[background-color] duration-[200ms] ease-out"
        >
          <div className="w-full max-w-lg border border-[color:var(--border)] bg-[color:var(--sc-surface)] transition-[transform,opacity] duration-[200ms] ease-out">
            <div className="flex items-center justify-between border-b border-[color:var(--border)] px-6 py-4">
              <span className="text-[15px] font-medium leading-[1.4]">Preview</span>
              {shortcode ? <span className="text-sm leading-4 text-[color:var(--secondary)]">{shortcode}</span> : null}
            </div>
            <div className="bg-[color:var(--sc-background)]">
              {videoUrl && (
                /* eslint-disable-next-line jsx-a11y/media-has-caption */
                <video src={videoUrl} controls poster={data && "thumbnail" in data ? data.thumbnail : undefined} className="block w-full" />
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md border border-[color:var(--border)] bg-[color:rgba(255,255,255,0.05)] px-4 py-2 text-[15px] font-medium leading-[1.45] text-[color:var(--foreground)] transition-all duration-[150ms] ease-out hover:bg-[color:rgba(255,255,255,0.09)] active:scale-[0.98]"
              >
                Close
              </button>
              {downloadHref && (
                <button
                  onClick={() => (window.location.href = downloadHref)}
                  className="rounded-md bg-[color:var(--foreground)] px-4 py-2 text-[15px] font-medium leading-[1.45] text-[#0a0a0a] transition-all duration-[150ms] ease-out hover:bg-[color:rgb(255_255_255/_90%)] active:scale-[0.98]"
                >
                  Download .mp4
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
