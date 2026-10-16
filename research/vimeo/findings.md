# Vimeo anonymous extraction feasibility (issue #8)

Date: 2026-10-16. Method: plain `fetch` with a browser UA from Bun, no login, no keys, no yt-dlp.
Test video: `https://vimeo.com/76979871` ("The New Vimeo Player", public). Light probing only.

## Verdict: feasible-with-caveats (not a reliable best-MP4 source)

A public **embeddable** Vimeo video's streams can be read anonymously via the player
config JSON. But the direct-**MP4** (`progressive`) array was **empty** on the tested
public video — only adaptive HLS/DASH URLs were returned. So the endpoint works, yet
the app's best-MP4 auto-pick often has nothing to pick. Treat Vimeo as
best-effort/adaptive-only unless a corpus sample proves `progressive` is still
commonly populated.

## What works today

`GET https://player.vimeo.com/video/{id}/config` (anonymous; works with or without
`Referer`, `Accept: application/json`) → 200 JSON shaped:

- `video.title`, `video.id` — metadata.
- `request.files.progressive` — array of `{ width, height, fps, mime, url }` direct MP4s
  when present (empty `[]` on the tested video). Best-pick = max `width*height`,
  which maps 1:1 onto the app's best-MP4 auto-pick in `app/lib/media-resolver.ts`.
- `request.files.hls.cdns.*.url`, `request.files.dash.cdns.*.url` — signed adaptive
  playlists (verified: HLS master fetches anonymously, 200, valid `#EXTM3U`).
- Same file set is embedded in `GET https://player.vimeo.com/video/{id}` HTML
  (`"progressive":[]` observed inline) — the page is a fallback if the `/config`
  path ever moves.

URL plumbing: `vimeo.com/{id}` pages carry
`<meta property="og:video:url" content="https://player.vimeo.com/video/{id}?h={token}">`.
Forward the `?h=` token to `/config?h=` — unlisted videos require it; harmless otherwise.

## What does NOT yield MP4s

- **oEmbed** (`vimeo.com/api/oembed.json?url=…`) — returned 404 even for the valid
  public test video, and by spec returns only metadata/thumbnail/player HTML, never
  media files. Not an extraction avenue.
- **`og:video` meta on vimeo.com pages** — points at the player (`text/html`), not an MP4.

## Privacy boundaries (observed HTTP codes on `/config`)

- Public + embedding enabled → 200.
- Embedding disabled / domain-restricted → **403** (two other public IDs returned 403).
- Deleted/private/nonexistent → **404**.
- Unlisted (`/12345/abcdef1234` links) → needs the `h` hash forwarded; without it, 404/403.

So: anything the owner de-embedded or restricted is unreachable by this method. No bypass found.

## Reliability

- Undocumented, unofficial endpoint — path/shape can change without notice (it has before).
- All stream URLs are signed with `exp=…` expiry (~hours): extract-then-download promptly,
  never persist the URL.
- `progressive` emptiness is the main functional risk; HLS/DASH need remuxing (out of
  scope for a plain-`fetch` best-MP4 resolver).
- Server-side fetching from one IP risks rate-limiting at scale — unmeasured here.

## ToS note

Vimeo's terms restrict downloading/copying streams except via an explicit download
feature; pulling `progressive`/HLS URLs server-side to offer downloads bypasses the
player and its controls. Product decision needed before building on this — research
only, no implementation proposed.

## Open questions

- What fraction of real-world public videos still populate `progressive`? (Needs a
  corpus sample; single-video probe is insufficient.)
- Rate limits / bot detection on server-side `/config` fetching at volume?
- Product call: is adaptive-HLS (no direct MP4) acceptable, or is Vimeo out of scope?
