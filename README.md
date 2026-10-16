# Video downloader

Paste a public Instagram or X (Twitter) post URL, preview it, and download the MP4. No login, no storage — the file is streamed straight from the platform's CDN.

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

`CONTEXT.md` holds the domain language. Two deep modules sit behind an injectable `fetch` seam, which is where the tests plug in fixtures:

- `app/lib/media-resolver.ts` — `resolve(sourceUrl, deps) → VideoAsset`. Picks the platform from the URL, then either scrapes the Instagram post page (`og:video`, with an embed fallback) or asks X's syndication endpoint for the tweet's `video_info` variants and keeps the highest-bitrate MP4. Rejects private or login-required Instagram posts, photo-only tweets, and text-only tweets.
- `app/lib/transfer.ts` — `proxy(videoUrl, filename, deps) → Response` and `isAllowedHost(url)`. Owns the CDN allowlist (https only), streams the upstream body through, and names the download `<filename>.mp4`.

Routes: `/` serves the form and preview; `/api/download?url=…&name=…` streams the file.

Only allowlisted CDN hosts can be proxied, so the download route can't be used as an open proxy.

## Deploy

```bash
docker build -t video-downloader .
docker run -p 3000:3000 video-downloader
```

## Legal

Only download content you have rights to. Respect Instagram's and X's terms.
