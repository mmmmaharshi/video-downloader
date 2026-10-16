import type { LoaderFunctionArgs } from "react-router";
import { fromDownloadRequest } from "../lib/download-link";
import { proxy } from "../lib/transfer";

export async function loader({ request }: LoaderFunctionArgs) {
  const { videoUrl, stem } = fromDownloadRequest(request.url);

  return proxy(videoUrl, stem);
}
