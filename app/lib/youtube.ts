// Module: YouTube — anonymous MP4 extraction via the IOS InnerTube client.
// Interface: getYouTubeFormats(id, deps?) → TubeAsset[] (best rendition first).
// The IOS client returns plain playback URLs with no attestation; the default WEB
// client is gated and yields none. Some videos (typically label music) refuse anonymous
// playback on every IOS url — all renditions 403 together — so a HEAD probe on the best
// url gates each client and ANDROID (360p, playable) is the fallback.
// Seam: getInfo + fetch (live Innertube in prod, stubs in tests).

import { Innertube } from "youtubei.js";

export interface TubeAsset {
  videoUrl: string;
  height: number;
  title?: string;
}

export interface YouTubeDeps {
  getInfo?: (id: string, client: ClientName) => Promise<TubeInfo> | TubeInfo;
  fetch?: typeof fetch;
}

type ClientName = "IOS" | "ANDROID";

const CLIENTS: ClientName[] = ["IOS", "ANDROID"];

interface TubeFormat {
  url?: string;
  mime_type: string;
  width?: number;
  height?: number;
}

export interface TubeInfo {
  playability: string;
  reason?: string;
  title?: string;
  formats: TubeFormat[];
}

// one anonymous session per process; a failed creation retries on the next call
let session: Promise<Innertube> | undefined;

const getSession = async (): Promise<Innertube> => {
  if (!session) {
    // assigned before awaiting so concurrent callers share one creation
    session = Innertube.create();

    try {
      await session;
    } catch (error) {
      session = undefined;
      throw error;
    }
  }

  return session;
};

const liveGetInfo = async (
  id: string,
  client: ClientName
): Promise<TubeInfo> => {
  const tube = await getSession();
  const info = await tube.getBasicInfo(id, { client });
  const sd = info.streaming_data;

  return {
    formats: [...(sd?.formats ?? []), ...(sd?.adaptive_formats ?? [])].map(
      (f) => ({
        height: f.height,
        mime_type: f.mime_type,
        url: f.url,
        width: f.width,
      })
    ),
    playability: info.playability_status?.status ?? "UNKNOWN",
    reason: info.playability_status?.reason ?? undefined,
    title: info.basic_info?.title ?? undefined,
  };
};

const headOk = async (head: typeof fetch, url: string): Promise<boolean> => {
  try {
    const res = await head(url, { method: "HEAD" });

    return res.ok;
  } catch {
    return false;
  }
};

// sort runs on the mapped copy, so nothing shared is mutated (toSorted
// needs ES2023 lib, which this project does not target)
const bestMp4s = (info: TubeInfo): TubeAsset[] =>
  info.formats
    .filter(
      (f): f is TubeFormat & { url: string } =>
        f.mime_type.startsWith("video/mp4") && f.url !== undefined
    )
    .map((f) => ({ height: f.height ?? 0, videoUrl: f.url }))
    // eslint-disable-next-line unicorn/no-array-sort -- fresh mapped copy, and toSorted needs ES2023 lib
    .sort((a, b) => b.height - a.height);

export const getYouTubeFormats = async (
  id: string,
  deps: YouTubeDeps = {}
): Promise<TubeAsset[]> => {
  const getInfo = deps.getInfo ?? liveGetInfo;
  const head = deps.fetch ?? fetch;
  let answered = false;
  let failure: unknown;
  let reason: string | undefined;

  for (const client of CLIENTS) {
    let info: TubeInfo;

    try {
      // eslint-disable-next-line no-await-in-loop -- ANDROID is the fallback for exactly the videos IOS failed
      info = await getInfo(id, client);
    } catch (error) {
      failure ??= error;
      continue;
    }

    answered = true;

    if (info.playability !== "OK") {
      reason ??= info.reason;
      continue;
    }

    const mp4s = bestMp4s(info);

    if (!mp4s.length) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- the HEAD probe gates this client before falling back to the next
    if (await headOk(head, mp4s[0].videoUrl)) {
      return mp4s.map((m) => ({ ...m, title: info.title }));
    }
  }

  if (!answered) {
    throw new Error("YouTube is unreachable right now. Try again later.", {
      cause: failure,
    });
  }

  if (reason) {
    throw new Error(
      `This video is unavailable${`: ${reason}`}. Private or age-restricted videos need a login, which is not supported.`
    );
  }

  return [];
};
