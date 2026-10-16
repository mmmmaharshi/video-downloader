# Research: Reddit anonymous extraction feasibility (issue #7)

## Verdict

**Feasible, but only via a third-party mirror — no first-party anonymous path works today.**
Chain (all plain `fetch`, no login/keys/yt-dlp, Bun-native):

```
post URL → base36 id ──► Arctic Shift /api/posts/ids?ids=<id>
  → data[0].media.reddit_video.fallback_url (signed progressive MP4)
  → 206 video/mp4 verified live (Range probe, ftyp box)
```

Direct Reddit avenues are all dead from a server fetch (verified 2026-10-16, ~10 light requests total).
`fallback_url` keeps the app's best-MP4 auto-pick trivially (single progressive file; no DASH assembly needed).

## What was tested (endpoint, result)

| Avenue | Result |
|---|---|
| `www.reddit.com/<permalink>.json` (browser UA) | **403** + 190KB block page |
| `old.reddit.com/<permalink>.json` | **redirect to /login/?reason=lor2**, then 404 |
| `old.reddit.com/r/<sub>/` listing | **login wall** ("Welcome to Reddit", 0 posts) |
| `www.reddit.com` post/sub HTML | **200 but bot-challenge page** (~8KB JS PoW form, no content) |
| `www.reddit.com/oembed?url=<permalink>` | 200 JSON, but **no media URL** (embed blockquote + widgets.js only) |
| `v.redd.it/<id>/DASHPlaylist.mpd` unsigned | **403 "Access denied"** |
| `v.redd.it/<id>/DASH_360.mp4` unsigned (Range probe) | **403** |
| Arctic Shift `GET /api/posts/ids?ids=<id>` | **200**, full post record incl. `media.reddit_video` |
| Signed `packaged-media.redd.it/.../m2-res_960p.mp4?...&e=...&s=...` (Range 0-1023) | **206 video/mp4** (`ftyp`), 1024 bytes — works |

Sample post used: `r/videos/comments/8l0bfp` (link post, negative control) and live
native-video posts from mirror search (`1x7akmh`, `1x7ce5k`, …).

## Parsing detail (the working method)

1. Extract post id from URL: `/comments/([a-z0-9]+)/i` (base36; `t3_` prefix optional).
2. `GET https://arctic-shift.photon-reddit.com/api/posts/ids?ids=<id>` (any UA; JSON).
3. If `data[0].is_video === true` and `data[0].media?.reddit_video`:
   - `fallback_url` = direct progressive MP4 (e.g. `https://packaged-media.redd.it/<vid>/dl/m2-res_960p.mp4?m=…&e=<expiry>&s=<sig>`). Use as-is, at request time.
   - `dash_url` / `hls_url` (signed `v.redd.it/.../DASHPlaylist.mpd`, `HLSPlaylist.m3u8`) are fallbacks if multi-rendition picking is ever needed; `is_gif` flags silent GIF-videos.
4. Else: no downloadable video (link/self/image post) — same "No video found" error shape as the IG/X resolvers.

## Rate limits / reliability

- Reddit first-party: unmeasurable — blocked by anti-bot/login wall before any rate-limit
  accounting. (Docs historically claimed ~10 unauth req/min; observed reality is a hard block.)
- Mirror: no documented quota hit during testing; upstream is a volunteer-run service
  (ArthurHeitmann/arctic_shift) — treat as best-effort, add timeout + "try again later" on non-200.
- Signed media URLs expire in **hours** (`e=` epoch param; one verified-dead, one verified-live
  token side by side). Resolve at request time; never persist the file URL.

## Coverage per post shape

- Native video (`is_video`, incl. GIFs): **covered** when the mirror record carries `media.reddit_video`. Caveat: some records have `media: null` (observed 1 of 3) — reason unknown (takedown/ingest gap?).
- Galleries: mirror records carry `gallery_data` + `media_metadata` (image shape verified); **video-in-gallery MP4 path not verified** — open question.
- Link posts (YouTube etc.), self/text posts: correctly yield "no video" — out of scope by design.
- Freshness: mirror indexed same-week posts in testing, but **ingest lag for minutes-old posts unmeasured** — brand-new posts may 404 on the mirror.

## ToS note

Scraping Reddit directly would breach Reddit's User Agreement / API Terms (which is moot —
it's technically blocked). The mirror path shifts dependence to Arctic Shift's terms and a
volunteer operator; hotlinking `packaged-media.redd.it` signed URLs is the same bytes the
official player fetches, but redistribution rights remain with the poster/Reddit. Keep
server-side fetch + redirect-to-file (no rehosting), same as the IG/X resolvers.

## Open questions (for the implementation ticket)

1. Mirror ingest lag for minutes-old posts — measure before promising "paste any link".
2. `media: null` records — how common; retry or error?
3. Video-in-gallery (`media_metadata` mp4 entries) parsing — verify one sample.
4. Mirror rate limits / SLA — confirm with operator docs; add caching of *post id → video id* (not file URL).
5. Higher-than-fallback resolutions need signed DASH/HLS parsing — is `fallback_url` quality enough?
