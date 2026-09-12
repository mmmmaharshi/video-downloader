import type { LoaderFunctionArgs } from "react-router";
import { proxy } from "../lib/transfer";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const videoUrl = url.searchParams.get("url");
  const shortcode = url.searchParams.get("code") ?? "video";

  if (!videoUrl) throw new Response("Missing url", { status: 400 });

  return proxy(videoUrl, shortcode);
}
