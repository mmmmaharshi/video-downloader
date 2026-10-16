import { resolve } from "../lib/media-resolver";
import { rememberResolved } from "../lib/recent-resolves";
import type { ResolveResult } from "../lib/resolve-query";
import type { Route } from "./+types/api.resolve";

export const action = async ({
  request,
}: Route.ActionArgs): Promise<Response> => {
  const formData = await request.formData();
  const url = String(formData.get("url") ?? "").trim();
  try {
    const assets = await resolve(url);
    for (const a of assets) {
      rememberResolved(a.videoUrl);
    }
    return Response.json({ assets, inputUrl: url } satisfies ResolveResult);
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Failed to extract video";
    return Response.json({ error: msg, inputUrl: url } satisfies ResolveResult);
  }
};
