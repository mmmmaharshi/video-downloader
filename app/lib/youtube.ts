// Module: YouTube — anonymous MP4 extraction via the IOS InnerTube client.
// Interface: getYouTubeFormats(id, deps?) → TubeAsset[] (best rendition first).
// The IOS client returns plain playback URLs with no attestation; the default WEB
// client is gated and yields none. Some videos (typically label music) refuse anonymous
// playback on every IOS url — all renditions 403 together — so a HEAD probe on the best
// url gates each client and ANDROID (360p, playable) is the fallback.
// Seam: getInfo + fetch (live Innertube in prod, stubs in tests).

import { Innertube } from "youtubei.js";

export type TubeAsset = { videoUrl: string; height: number; title?: string };
export type YouTubeDeps = {
  getInfo?: (id: string, client: ClientName) => Promise<TubeInfo>;
  fetch?: typeof fetch;
};

type ClientName = "IOS" | "ANDROID";
const CLIENTS: ClientName[] = ["IOS", "ANDROID"];

type TubeFormat = { url?: string; mime_type: string; width?: number; height?: number };
export type TubeInfo = { playability: string; reason?: string; title?: string; formats: TubeFormat[] };

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

async function liveGetInfo(id: string, client: ClientName): Promise<TubeInfo> {
  const tube = await getSession();
  const info = await tube.getBasicInfo(id, { client });
  const sd = info.streaming_data;
  return {
    playability: info.playability_status?.status ?? "UNKNOWN",
    reason: info.playability_status?.reason ?? undefined,
    title: info.basic_info?.title ?? undefined,
    formats: [...(sd?.formats ?? []), ...(sd?.adaptive_formats ?? [])].map((f) => ({
      url: f.url,
      mime_type: f.mime_type,
      width: f.width,
      height: f.height,
    })),
  };
}

async function headOk(head: typeof fetch, url: string): Promise<boolean> {
  try {
    return (await head(url, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
}

function bestMp4s(info: TubeInfo): TubeAsset[] {
  return info.formats
    .filter((f): f is TubeFormat & { url: string } => f.mime_type.startsWith("video/mp4") && f.url !== undefined)
    .map((f) => ({ videoUrl: f.url, height: f.height ?? 0 }))
    .sort((a, b) => b.height - a.height);
}

export async function getYouTubeFormats(id: string, deps: YouTubeDeps = {}): Promise<TubeAsset[]> {
  const getInfo = deps.getInfo ?? liveGetInfo;
  const head = deps.fetch ?? fetch;
  let answered = false;
  let failure: unknown;
  let reason: string | undefined;
  for (const client of CLIENTS) {
    let info: TubeInfo;
    try {
      info = await getInfo(id, client);
    } catch (e) {
      failure ??= e;
      continue;
    }
    answered = true;
    if (info.playability !== "OK") {
      reason ??= info.reason;
      continue;
    }
    const mp4s = bestMp4s(info);
    if (!mp4s.length) continue;
    if (await headOk(head, mp4s[0].videoUrl)) return mp4s.map((m) => ({ ...m, title: info.title }));
  }
  if (!answered) throw new Error("YouTube is unreachable right now. Try again later.", { cause: failure });
  if (reason)
    throw new Error(
      `This video is unavailable${`: ${reason}`}. Private or age-restricted videos need a login, which is not supported.`,
    );
  return [];
}
