# Rumble anonymous extraction — findings

**Verdict: FEASIBLE.** A Rumble VOD's direct MP4 URLs are obtainable anonymously
(no login, no API keys, no yt-dlp) with two plain `fetch` calls. Verified live
2026-10-16 with Bun-native `fetch` only.

## Method (verified end-to-end)

1. **Watch page → embed video id.** `GET https://rumble.com/<slug>.html` and extract
   the id from the first `rumble.com/embed/<id>` URL in the HTML
   (e.g. slug `vdmum1-...` → embed id `vb0ofn`). The id is NOT the slug.
2. **Player JSON → MP4s.** `GET https://rumble.com/embedJS/u3/<id>?request=video&ver=2&v=<id>`
   returns JSON. Direct progressive MP4s live at `ua.mp4[]`, each
   `{url, meta: {w, h, bitrate, size}}`. Best-MP4 auto-pick = max `meta.h`
   (verified video offered 360p/480p/720p/1080p MP4s on `*.cdn.rumble.cloud`,
   plus `webm`; `hls`/`tar` keys appear for live/other cases — skip `tar`).

Same source yt-dlp uses (`RumbleEmbedIE`: `embedJS/u3/` + `request=video&ver=2`).

## Gotchas for `media-resolver.ts`

- **Watch page is cookie-gated, not UA-gated.** First response is `307` to the same
  URL with `Set-Cookie: RNSC=...`. `fetch` has no cookie jar, so the default
  redirect-follower loops/times out — use `redirect: "manual"`, harvest the
  `set-cookie`, resend as `Cookie`, follow the `Location` (1 hop sufficed).
- **`embedJS` needs nothing**: no cookies, no UA, no referer. 200 OK either way.
- **URL shape**: `/v<slug>` watch URLs; validate `^https?://(www\.)?rumble\.com/v(?!ideos)[\w.-]+`.

## Dead end

- **oEmbed** (`/api/Media/oEmbed.json?url=...`) returns
  `"You must be signed in to perform this action"` — metadata only anyway
  (no stream URLs), so useless for this purpose.

## Reliability

- Both endpoints are public, unauthenticated, and stable (yt-dlp has relied on
  `embedJS/u3` for years). Main fragility: Rumble may change the embed-URL
  markup or the `embedJS` response schema without notice — re-verify on failure.
- Minor: `rumble.com` DNS flaked twice during testing (transient, retried fine).

## Livestream vs VOD coverage

- **VOD: full** — progressive MP4 renditions, verified.
- **Live: partial (untested live).** Per yt-dlp's parsing of the same JSON:
  `live: 2` = active live → `hls` (m3u8) formats, no direct MP4; `live: 1` with
  DVR = completed stream, MP4s available (`was_live`/`post_live`). Our best-MP4
  pipeline fits VOD + finished streams; active live would need an m3u8 path
  (out of scope for the current downloader).

## ToS note

Rumble's Terms of Use grant content for personal/streaming viewing; bulk or
programmatic downloading may violate them. Same posture as the existing
Instagram/X resolvers — keep to single user-pasted URLs, no crawling.

## Open questions

- None blocking. Optional follow-up: probe one active livestream to confirm the
  `hls`-only shape before ever claiming live support.
