# Video downloader

Paste a public Instagram, X (Twitter), or YouTube URL, preview it, and download the MP4. Posts with several videos show a pager in the preview and one download button per video. No login, no storage — the file is streamed straight from the platform's CDN.

## Requirements

[Bun](https://bun.sh) is the runtime and package manager.

## Development

```bash
bun install
bun run dev
```

The dev server runs at `http://localhost:5173`.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server with HMR |
| `bun run build` | Production build into `build/` |
| `bun run start` | Serve the production build |
| `bun run typecheck` | Generate route types and run `tsc` |
| `bun test` | Run the test suite |

## How it works

`CONTEXT.md` holds the domain language. Small modules sit behind injectable seams, which is where the tests plug in fixtures:

- `app/lib/media-resolver.ts` — `resolve(sourceUrl, deps) → VideoAsset[]`. Picks the platform from the URL, then either scrapes the Instagram post page (`og:video`, with an embed fallback), asks X's syndication endpoint for the tweet's `video_info` variants, or asks YouTube's InnerTube API (anonymous IOS client) for MP4 renditions — keeping the best MP4 of every video in the post. Rejects private or login-required posts, photo-only tweets, and text-only tweets.
- `app/lib/youtube.ts` — `getYouTubeFormats(id, deps) → TubeAsset[]` (best rendition first). Owns the anonymous InnerTube session and the streaming-data mapping.
- `app/lib/transfer.ts` — `proxy(videoUrl, stem, deps) → Response` and `isAllowedHost(url)`. Owns the CDN allowlist (https only), streams the upstream body through with an overall deadline, passes the size through, and names the download `<stem>.mp4`.
- `app/lib/preview.ts` — `nextPreview(state, event) → PreviewState`. Owns the preview's open/dismiss rule.
- `app/lib/download-link.ts` — `toDownloadHref(assets, index)` and `fromDownloadRequest(url)`. Owns the download link both routes share.
- `app/lib/recent-resolves.ts` — `rememberResolved(url)` and `wasResolved(url)`. The form remembers what it resolved; the download route only serves those.

Routes: `/` serves the form and preview; `/api/download?url=…&name=…` streams the file.

Only allowlisted CDN hosts can be proxied, and only for links the form resolved in the last ten minutes — the download route answers the app, not the internet.

## Deploy

```bash
docker build -t video-downloader .
docker run -p 3000:3000 video-downloader
```

## Legal

Only download content you have rights to. Respect Instagram's and X's terms.
