import type { LoaderFunctionArgs } from "react-router";
import { proxy } from "../lib/transfer";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shortcode = url.searchParams.get("code") ?? "video";

  return proxy(url.searchParams.get("url"), shortcode);
}
