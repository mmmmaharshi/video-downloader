# Research: Facebook anonymous extraction feasibility

## Verdict: INFEASIBLE with Bun-native plain `fetch` — no direct MP4 obtainable anonymously

Public Facebook video pages fetched with a plain server-side `fetch` (desktop Chrome UA,
no cookies, no TLS impersonation) return HTTP 200 HTML that contains **title and thumbnail
but zero video-file references**. No `playable_url`, `playable_url_quality_hd`, `og:video`,
`video_url`, `hd_src`/`sd_src`, `.mp4`, or `fbcdn` video hosts appear anywhere in the
payload. The video bytes are delivered only through JS-driven follow-up calls whose
responses are gated on browser-like TLS/session signals. This fails the ticket's core
constraint (plain fetch, best-MP4 auto-pick like `app/lib/media-resolver.ts` does for
Instagram/X), so Facebook **re-orders to last in the batch** (or needs out-of-scope
tooling — see §5).

## What was tested (light anonymous probing, ~12 requests total, Oct 2026)

All requests: `fetch` with desktop Chrome UA, `Accept-Language: en-US`, no cookies/auth.
IDs used are real video IDs taken from yt-dlp's own test suite (not fabricated).

| Probe | Result |
|---|---|
| `GET www.facebook.com/reel/<fake-id>/` | HTTP 400, generic "We're working on getting this fixed" shell (fake IDs die here) |
| `GET m.facebook.com/watch/?v=<fake-id>` | Same 400 shell |
| `GET www.facebook.com/plugins/video/oembed.json/?url=<reel>` | HTTP 400 error page (unauthenticated oEmbed is dead — see §2) |
| `GET m.facebook.com/watch/?v=1195289147628387` (real reel) | **200, ~450–940KB HTML** (size varies per request). Markers: `og:image` ✅, `<title>` = video title ✅, `__bbox` ✅, `dtsg` ✅ — but `playable*` ❌, `fbcdn` ❌, `dash_manifest` ❌, `VideoConfig` ❌, `og:video` ❌, `video_url` ❌, `hd_src`/`sd_src` ❌, `.mp4` ❌, `videoId` ❌, `creation_story` ❌, `RelayPrefetchedStreamCache` ❌, `login_form`/`captcha`/`checkpoint` ❌ |
| `GET www.facebook.com/video/video.php?v=274175099429670` (real) | 200, ~714KB. Same shape: `og:image` ✅, no MP4 markers ❌ |
| `GET www.facebook.com/radiokicksfm/videos/3676516585958356/` (real page video) | 200, ~490KB. **Not even `og:image`** — page-post videos expose less than reels/watch |
| `GET www.facebook.com/robots.txt` | 200 — and it explicitly **prohibits automated collection without express written permission** (see §6) |
| `GET mbasic.facebook.com/` | 200 but returns an error shell — the basic-HTML path is deprecated/unusable |

A second scan of the reel page confirmed the only media host present is
`scontent.*.fbcdn.net` **thumbnails** (`og:image` → `..._n.jpg`); `fbsbx` appears but
with no retrievable media. `login.php` links are present in-page (nav chrome), but no
login *wall* markers — i.e. this is a JS-shell limitation, not a login redirect like
Instagram's `/accounts/login` case.

## Endpoint-by-endpoint assessment

1. **oEmbed (`/plugins/video/oembed.json`) — OUT.** Requires an app access token since
   Meta removed unauthenticated oEmbed (~2020), which violates "no API keys". Even
   authenticated it returns embed HTML + thumbnail, never a direct MP4.
2. **Mobile/basic variants (`m.facebook.com`, `mbasic.facebook.com`) — INSUFFICIENT.**
   `m.facebook.com/watch/?v=<id>` (yt-dlp's own reel canonicalization target) returns
   the same MP4-less shell under plain fetch. `mbasic` serves an error shell; the
   historical "view-source finds video links" trick is dead.
3. **Page-embedded JSON (`__bbox`/Relay `data-sjs`, `ServerJS/VideoConfig`, tahoe
   async endpoint) — ABSENT under plain fetch.** yt-dlp's extractor
   (`yt_dlp/extractor/facebook.py`) reads `playable_url` / `playable_url_quality_hd` /
   `dash_manifest` / `progressive_urls` / `browser_native_*_url` out of Relay
   prefetched JSON — but those payload keys simply are not in the HTML a plain fetch
   receives. yt-dlp additionally (a) impersonates Chrome TLS via `curl_cffi`
   (Bun's fetch cannot do this), (b) falls back to the `tahoe/async` endpoint with
   `fb_dtsg` tokens scraped from the page, and (c) still marks many fixtures
   "Requires logging in" / "Video gone". None of (a)–(b) fit "Bun-native fetching",
   and (c) caps reliability even with heavier tooling.
4. **Embed iframe (`/plugins/video.php?href=…`) — NOT VERIFIED, low promise.** Same
   JS-player shell family as the pages above; yields at best the same metadata.
   Skipped live probing to keep request volume minimal.

## Coverage per URL shape

| Shape | Canonicalization | MP4 via plain fetch |
|---|---|---|
| `facebook.com/reel/<digits>` | direct | ❌ (title + thumbnail only) |
| `facebook.com/watch/?v=<digits>` | direct | ❌ (title + thumbnail only) |
| `facebook.com/<page>/videos/<digits>` | direct | ❌ (title only; not even `og:image` observed) |
| `facebook.com/video.php?v=<digits>` | direct | ❌ (title + thumbnail only) |
| `fb.watch/<code>` | 302 → canonical `facebook.com/…` (standard redirect-following; no live short-code tested — no real code on hand, and probing fabricated codes proves nothing) | ❌ downstream of the above |
| `facebook.com/share/r|v/<token>`, `/photo?fbid=` | resolve to reel/video IDs (yt-dlp #16652 documents `/photo?fbid=` ≡ reel ID) | ❌ same page-level limitation |

## Login-wall boundaries (observed, not bypassed)

- Fake/deleted IDs → HTTP 400 error shell (indistinguishable from bot-gating; treat
  400 as "unresolvable", not "private").
- Real public IDs → 200 JS shell with title/thumbnail, no MP4, no login markers.
- Private/friends-only/age-gated content → per yt-dlp source: `id="login_form"` /
  "You must log in to continue" markers → `raise_login_required()`. Our resolver
  should map those markers to the same "login-required" error Instagram uses.
  Anything past this boundary (cookies, `c_user`/`xs`, App tokens, Graph API
  `Page Public Content Access`) is explicitly **out of scope** per the ticket.

## Reliability statement

- Title + thumbnail via plain fetch: **works today** for reels/watch/video.php
  (moderate confidence — one date-point, response size varies request-to-request,
  signaling A/B or bot-tiering).
- Direct MP4 via plain fetch: **does not work** (high confidence — zero video
  markers across 4 real-ID pages × 2 fetches each).
- Direct MP4 via yt-dlp-class tooling (TLS impersonation + Relay + tahoe,
  still no login): **partial** — works for many public videos but with documented
  login-walled gaps. That stack is outside this ticket's constraints.

## ToS / policy note

`robots.txt` on `www.facebook.com` states automated data collection is prohibited
without Meta's express written permission. Any future server-side resolver work
should get a policy review first; this alone is reason to keep Facebook last in
the batch regardless of technical feasibility.

## Open questions (for a future spike, if policy allows)

1. Does `facebookexternalhit/1.1` (Meta's crawler UA — the one yt-dlp uses for
   *downloading* formats) receive `og:video` on video pages where Chrome UA does
   not? (One cheap test; crawler-UA spoofing has its own policy smell.)
2. Do `fb.watch` short codes resolve server-side with plain `fetch` redirect
   following, or do they land on a JS interstitial? (Needs a *real* public
   fb.watch link.)
3. Is the response-size variance (447KB vs 938KB for the same reel URL) bot-tiering
   that sometimes includes fuller Relay data? (Would need repeated sampling.)

## Method reference

- `yt_dlp/extractor/facebook.py` (master, ~1189 lines): canonical anonymous
  technique — `m.facebook.com/watch/?v=<id>` for reels, Relay `data-sjs` regex
  `"dash_manifest|playable_url(?:_quality_hd)?"`, tahoe async fallback,
  `login_form` → login-required. Requires `curl_cffi` Chrome impersonation;
  not reproducible with Bun-native `fetch`.
