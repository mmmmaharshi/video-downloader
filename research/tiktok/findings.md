# TikTok anonymous extraction feasibility (Bun-native fetch only)

**Verdict: INFEASIBLE** with the ticket's constraints (no login, no API keys, no yt-dlp, plain `fetch` server-side). Re-order the batch: do not schedule TikTok support on the current `media-resolver.ts` approach.

## What was tested (live, 2026-10-16, light single requests, desktop Chrome UA, no auth)

| Avenue | Request | Result |
|---|---|---|
| oEmbed | `GET https://www.tiktok.com/oembed?url=<share URL>` + `Accept: application/json` | HTTP 200 but `content-type: text/html`, ~86 KB generic shell — no JSON. Even when it serves JSON (browser context), by design it returns only `html` (embed blockquote + `embed.js`), `thumbnail_url`, author/title — **never an MP4**. Source: TikTok embed docs (`developers.tiktok.com/doc/embed-videos`) + oembedproviders field list. |
| Video page HTML | `GET https://www.tiktok.com/@tiktok/video/7255384286750396206` (desktop UA, referer, lang headers) | HTTP 200, ~86 KB, but **none** of `__UNIVERSAL_DATA_FOR_REHYDRATION__`, `SIGI_STATE`, `sigi-persisted-data`, `playAddr`, `play_addr`, `og:video`, `tt_chain_token` present; no `og:video` meta tags at all. Stub shell, not the hydrated page. |
| Embed | `GET https://www.tiktok.com/embed/v2/7255384286750396206` | HTTP 200, only ~1,485 bytes, no `playAddr`, no video meta. Blocked/shell. |
| Unsigned API | `GET https://www.tiktok.com/api/item/detail/?aweme_id=...&aid=1988` | HTTP 200 but body is a `SlardarWAF` challenge page, not JSON. |

Share-link (`vm.tiktok.com` / `vt.tiktok.com`) resolution was not exercised beyond this: it only yields the canonical page URL, which then hits the same wall above.

## Why page-embedded JSON doesn't work with plain fetch

yt-dlp's TikTok extractor (reference: `yt_dlp/extractor/tiktok.py`) reads `playAddr`/`download_addr`/`bitrateInfo[].PlayAddr.UrlList` from `__UNIVERSAL_DATA_FOR_REHYDRATION__` / `SIGI_STATE` rehydration JSON. Getting that JSON server-side today requires a browser-like session: homepage cookies, WAF/Slardar proof, `X-Bogus`/`X-Gnarly` request signing via MSSDK, TLS/HTTP2 impersonation, and cookie-carrying CDN fetch (signed `v16-webapp-prime` URLs + 403-prone hosts). Community evidence (2025–2026): unsigned API calls return empty/WAF-capped bodies; `playAddr` CDN hosts 403 non-browser requests; projects fall back to signature sidecars or yt-dlp. None of that fits "plain Bun fetch, no signing, no deps."

Mobile/share endpoints (`m.tiktok.com`, `api16`/`aweme` hosts) have the same signing/cookie gate; no documented keyless JSON endpoint exposes `play_addr`.

## Reliability

Effectively zero for the constrained approach: every avenue returned challenge/shell content on first light try, and the one endpoint that is key-free by design (oEmbed) never carries a file URL. Even a lucky parse would be brittle — markup/IDs (`SIGI_STATE` → `__UNIVERSAL_DATA_FOR_REHYDRATION__` churn seen historically) and signed-URL expiry (hours) break it silently.

## Multi-video (carousel/photo) coverage

No per-video coverage via any candidate: oEmbed exposes one `thumbnail_url` only; page JSON (when obtainable with a full session) carries image slides, not per-slide MP4s, for photo posts. Best-MP4 auto-pick has nothing to pick from.

## ToS note

TikTok's Terms of Service prohibit scraping/circumventing technical measures; the sanctioned routes are the login-and-keyed Display/Research APIs (out of scope for this ticket's "anonymous, no keys" constraint). Server-side scraping also risks IP/ASN throttling (Slardar/Arkose), which affects all users of the host.

## What would make it feasible (out of scope, recorded only)

- Official TikTok Display or Research API (requires app review + keys), or
- A signing sidecar / yt-dlp-style session (explicitly excluded by the ticket), or
- A third-party no-key scraping API (external dependency, reliability/ToS concerns).

## Open questions

1. Batch decision: drop TikTok from scope or re-scope a ticket around a keyed official API?
2. If a future ticket allows a signing dependency: which signer (MSSDK `X-Bogus` sidecar vs yt-dlp) and how are CDN-cookie + 403 retry handled in `media-resolver.ts`?
