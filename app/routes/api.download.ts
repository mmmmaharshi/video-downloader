import type { LoaderFunctionArgs } from "react-router";

import { fromDownloadRequest } from "../lib/download-link";
import { wasResolved } from "../lib/recent-resolves";
import { proxy } from "../lib/transfer";

export function loader({ request }: LoaderFunctionArgs) {
  const { videoUrl, stem } = fromDownloadRequest(request.url);
  // the proxy answers the app, not the internet: only serve urls the form resolved
  if (!wasResolved(videoUrl)) {
    throw new Response("Resolve the link in the form first", { status: 403 });
  }

  return proxy(videoUrl, stem);
}
