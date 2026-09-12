// ponytail: naive scrape; swap to RapidAPI here if IG blocks
const INSTA_RE = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?(\?.*)?$/;

export function validateInstaUrl(url: string): { shortcode: string } | { error: string } {
  const trimmed = url.trim();
  if (!trimmed) return { error: "Paste an Instagram URL" };
  const m = trimmed.match(INSTA_RE);
  if (!m) return { error: "Invalid URL. Use https://instagram.com/reel/… or /p/…" };
  return { shortcode: m[3] };
}

export async function extractVideoUrl(instaUrl: string): Promise<{ videoUrl: string; thumbnail?: string; shortcode: string }> {
  const v = validateInstaUrl(instaUrl);
  if ("error" in v) throw new Error(v.error);

  const res = await fetch(instaUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (res.status === 404) throw new Error("Post not found. Check the URL.");
  if (res.redirected && res.url.includes("/accounts/login")) throw new Error("Private or login-required post. Only public posts are supported.");
  if (!res.ok) throw new Error(`Instagram returned ${res.status}. Try again later.`);

  const html = await res.text();

  if (html.includes("/accounts/login") && !html.includes("og:video")) {
    throw new Error("Private post or requires login. Only public posts work.");
  }

  // 1) og:video
  let videoUrl = html.match(/<meta\s+property="og:video:secure_url"\s+content="([^"]+)"/)?.[1]
    ?? html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/)?.[1]
    ?? html.match(/"video_url"\s*:\s*"([^"]+)"/)?.[1]
    ?? html.match(/"videoUrl"\s*:\s*"([^"]+)"/)?.[1];

  if (videoUrl) {
    videoUrl = videoUrl.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  }

  // 2) embed fallback — works logged-out in 2025-2026 when og:video is empty (double-escaped JSON in embed HTML)
  if (!videoUrl) {
    try {
      const embedUrl = `https://www.instagram.com/${instaUrl.includes("/reel/") ? "reel" : instaUrl.includes("/tv/") ? "tv" : "p"}/${v.shortcode}/embed/captioned/`;
      const er = await fetch(embedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (er.ok) {
        const ehtml = await er.text();
        const evRaw =
          ehtml.match(/(?:\\"|")video_url(?:\\"|")\s*:\s*(?:\\"|")([^"]+)(?:\\"|")/)?.[1] ??
          ehtml.match(/(?:\\"|")videoUrl(?:\\"|")\s*:\s*(?:\\"|")([^"]+)(?:\\"|")/)?.[1];
        if (evRaw) videoUrl = evRaw.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/\\/g, "").replace(/&amp;/g, "&");
      }
    } catch {}
  }

  if (!videoUrl) throw new Error("No video found. Only video/reel posts are downloadable, or IG changed its page.");

  const thumbnail = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");

  return { videoUrl, thumbnail, shortcode: v.shortcode };
}
