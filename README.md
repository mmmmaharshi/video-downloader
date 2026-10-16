# Video downloader

Paste a public Instagram reel or post URL, preview it, and download the MP4. No login, no storage — the file is streamed straight from Instagram's CDN.

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

- `app/lib/media-resolver.ts` — `resolve(sourceUrl, deps) → VideoAsset`. Validates the URL, extracts the shortcode, fetches the post page, reads `og:video`, and falls back to the embed page. Rejects private and login-required posts.
- `app/lib/transfer.ts` — `proxy(videoUrl, shortcode, deps) → Response` and `isAllowedHost(url)`. Owns the CDN allowlist (https only), streams the upstream body through, and sets the download filename.

Routes: `/` serves the form and preview; `/api/download?url=…&code=…` streams the file.

Only allowlisted CDN hosts can be proxied, so the download route can't be used as an open proxy.

## Deploy

```bash
docker build -t video-downloader .
docker run -p 3000:3000 video-downloader
```

## Legal

Only download content you have rights to. Respect Instagram's terms.
