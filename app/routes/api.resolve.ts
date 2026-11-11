import { toDownloadHref } from "../lib/download-link";
import { resolve } from "../lib/media-resolver";
import type { ResolveResult } from "../lib/resolve-query";
import type { Route } from "./+types/api.resolve";

export const action = async ({
  request,
}: Route.ActionArgs): Promise<Response> => {
  const formData = await request.formData();
  const url = String(formData.get("url") ?? "").trim();

  try {
    const assets = await resolve(url);

    // signed here, where the secret lives: the client only follows the href
    const resolved = assets.map((asset, index) => ({
      ...asset,
      downloadHref: toDownloadHref(assets, index),
    }));

    return Response.json({ assets: resolved } satisfies ResolveResult);
  } catch (error) {
    // an unexpected error is a bug, not a message for the user: keep it in the log
    console.error(error);

    const msg =
      error instanceof Error ? error.message : "Failed to extract video";

    return Response.json({ error: msg } satisfies ResolveResult);
  }
};
