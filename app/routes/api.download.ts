import type { LoaderFunctionArgs } from "react-router";

const ALLOWED_HOSTS = ["cdninstagram.com", "fbcdn.net", "scontent.cdninstagram.com"];

function isAllowedHost(url: string) {
  try {
    const h = new URL(url).hostname;
    return ALLOWED_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`) || h.includes(allowed));
  } catch {
    return false;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const videoUrl = url.searchParams.get("url");
  const shortcode = url.searchParams.get("code") ?? "video";

  if (!videoUrl) throw new Response("Missing url", { status: 400 });
  if (!isAllowedHost(videoUrl)) throw new Response("URL not allowed", { status: 400 });

  const upstream = await fetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!upstream.ok || !upstream.body) throw new Response(`Upstream ${upstream.status}`, { status: 502 });

  const contentType = upstream.headers.get("content-type") ?? "video/mp4";
  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="instagram-${shortcode}.mp4"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
