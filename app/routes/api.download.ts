import type { LoaderFunctionArgs } from "react-router";

import { fromDownloadRequest } from "../lib/download-link";
import { proxy } from "../lib/transfer";

export const loader = ({ request }: LoaderFunctionArgs) => {
  // a bad, altered or expired signature answers 403 before anything is fetched
  const { videoUrl, stem } = fromDownloadRequest(request.url);

  return proxy(videoUrl, stem, { range: request.headers.get("range") });
};
