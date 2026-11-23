// Module: YouTube — anonymous MP4 extraction via the IOS InnerTube client.
// Interface: getYouTubeFormats(id, deps?) → TubeAsset[] (best rendition first).
// The IOS client returns plain playback URLs with no attestation; the default WEB
// client is gated and yields none. Some videos (typically label music) refuse anonymous
// playback on every IOS url, so a HEAD probe walks each ladder until a rung
// plays and ANDROID (360p, playable) is the fallback. A sweep that answers OK
// but plays nothing is usually throttling, so it runs once more before giving up.
// Seam: getInfo + fetch (live Innertube in prod, stubs in tests).

import { Effect, Layer } from "effect";
import { Innertube } from "youtubei.js";

import { FetchDeps } from "./fetch-deps";
import type { HostLookup } from "./public-host";
import { defaultLookup } from "./public-host";
import {
  getYouTubeFormatsProgram,
  toThrownError,
  YouTubeInfo,
} from "./youtube-effect";

export interface TubeAsset {
  videoUrl: string;
  height: number;
  title?: string;
}

export interface YouTubeDeps {
  getInfo?: (id: string, client: ClientName) => Promise<TubeInfo> | TubeInfo;
  fetch?: typeof fetch;
  lookup?: HostLookup;
}

export type ClientName = "IOS" | "ANDROID";

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

// The format extraction runs as an Effect program (FetchDeps plus YouTubeInfo
// Layers) and is bridged back to promises here, so resolve()'s thrown-Error
// contract — including the unreachable cause — is unchanged.
export const getYouTubeFormats = async (
  id: string,
  deps: YouTubeDeps = {}
): Promise<TubeAsset[]> => {
  const layer = Layer.merge(
    Layer.succeed(FetchDeps)({
      doFetch: deps.fetch ?? fetch,
      lookup: deps.lookup ?? defaultLookup,
    }),
    Layer.succeed(YouTubeInfo)({ getInfo: deps.getInfo ?? liveGetInfo })
  );

  return await Effect.runPromise(
    Effect.mapError(
      Effect.provide(getYouTubeFormatsProgram(id), layer),
      toThrownError
    )
  );
};
