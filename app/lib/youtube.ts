// Module: YouTube — anonymous MP4 extraction via the IOS InnerTube client.
// Interface: getYouTubeFormats(id, deps?) → TubeAsset[] (best rendition first).
// The IOS client returns plain playback URLs with no attestation; the default WEB
// client is gated and yields none. A watch page is one video, so these are renditions,
// not separate videos — the resolver keeps the best.
// Seam: getInfo (live Innertube in prod, stub in tests).

import { Innertube } from "youtubei.js";

export type TubeAsset = { videoUrl: string; height: number };
export type YouTubeDeps = { getInfo?: (id: string) => Promise<TubeInfo> };

type TubeFormat = { url?: string; mime_type: string; width?: number; height?: number };
export type TubeInfo = { playability: string; reason?: string; formats: TubeFormat[] };

// one anonymous session per process; a failed creation retries on the next call
let session: Promise<Innertube> | undefined;
async function getSession(): Promise<Innertube> {
  if (!session)
    session = Innertube.create().catch((e) => {
      session = undefined;
      throw e;
    });
  return session;
}

async function liveGetInfo(id: string): Promise<TubeInfo> {
  const tube = await getSession();
  const info = await tube.getBasicInfo(id, { client: "IOS" });
  const sd = info.streaming_data;
  return {
    playability: info.playability_status?.status ?? "UNKNOWN",
    reason: info.playability_status?.reason ?? undefined,
    formats: [...(sd?.formats ?? []), ...(sd?.adaptive_formats ?? [])].map((f) => ({
      url: f.url,
      mime_type: f.mime_type,
      width: f.width,
      height: f.height,
    })),
  };
}

export async function getYouTubeFormats(id: string, deps: YouTubeDeps = {}): Promise<TubeAsset[]> {
  const getInfo = deps.getInfo ?? liveGetInfo;
  let info: TubeInfo;
  try {
    info = await getInfo(id);
  } catch (e) {
    throw new Error("YouTube is unreachable right now. Try again later.", { cause: e });
  }
  if (info.playability !== "OK")
    throw new Error(
      `This video is unavailable${info.reason ? `: ${info.reason}` : ""}. Private or age-restricted videos need a login, which is not supported.`,
    );
  return info.formats
    .filter((f): f is TubeFormat & { url: string } => f.mime_type.startsWith("video/mp4") && f.url !== undefined)
    .map((f) => ({ videoUrl: f.url, height: f.height ?? 0 }))
    .sort((a, b) => b.height - a.height);
}
