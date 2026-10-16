import type { LoaderFunctionArgs } from "react-router";
import { proxy } from "../lib/transfer";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const filename = url.searchParams.get("name") ?? "video";

  return proxy(url.searchParams.get("url"), filename);
}
