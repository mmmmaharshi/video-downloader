// Module: YouTube — anonymous MP4 extraction via the IOS InnerTube client.
// Interface: getYouTubeFormats(id, deps?) → TubeAsset[] (best rendition first).
// The IOS client returns plain playback URLs with no attestation; the default WEB
// client is gated and yields none. Some videos (typically label music) refuse anonymous
// playback on every IOS url, so a HEAD probe walks each ladder until a rung
// plays and ANDROID (360p, playable) is the fallback. A sweep that answers OK
// but plays nothing is usually throttling, so it runs once more before giving up.
// Seam: getInfo + fetch (live Innertube in prod, stubs in tests).

import { Effect, Layer, Schema } from "effect";

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

// One recent POST per client — no session object, no Node APIs, so the same
// code runs on Bun and on Workers. InnerTube answers the player payload the
// library used to parse for us; Schema reads only the fields we consume.
interface ClientContext {
  readonly androidSdkVersion?: number;
  readonly clientName: ClientName;
  readonly clientVersion: string;
  readonly deviceModel?: string;
  readonly osName: string;
  readonly osVersion: string;
}

const CLIENTS: Record<
  ClientName,
  { client: ClientContext; key: string; userAgent: string }
> = {
  ANDROID: {
    client: {
      androidSdkVersion: 34,
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      osName: "Android",
      osVersion: "14",
    },
    key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
    userAgent:
      "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
  },
  IOS: {
    client: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
    },
    key: "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc",
    userAgent:
      "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
};

const InnertubeFormat = Schema.Struct({
  height: Schema.optional(Schema.Number),
  mimeType: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
});

const InnertubePlayer = Schema.Struct({
  playabilityStatus: Schema.optional(
    Schema.Struct({
      reason: Schema.optional(Schema.String),
      status: Schema.optional(Schema.String),
    })
  ),
  streamingData: Schema.optional(
    Schema.Struct({
      adaptiveFormats: Schema.optional(Schema.Array(InnertubeFormat)),
      formats: Schema.optional(Schema.Array(InnertubeFormat)),
    })
  ),
  videoDetails: Schema.optional(
    Schema.Struct({ title: Schema.optional(Schema.String) })
  ),
});

const liveGetInfo = async (id: string, name: ClientName): Promise<TubeInfo> => {
  const { client, key, userAgent } = CLIENTS[name];

  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`,
    {
      body: JSON.stringify({ context: { client }, videoId: id }),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        "X-Youtube-Client-Name": name === "IOS" ? "5" : "3",
        "X-Youtube-Client-Version": String(client.clientVersion),
      },
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!res.ok) {
    throw new Error(`InnerTube ${name} returned ${res.status}`);
  }

  const payload = Schema.decodeUnknownSync(InnertubePlayer)(await res.json());
  const sd = payload.streamingData;

  return {
    formats: [...(sd?.formats ?? []), ...(sd?.adaptiveFormats ?? [])].flatMap(
      (f) =>
        f.url === undefined || f.mimeType === undefined
          ? []
          : [
              {
                height: f.height,
                mime_type: f.mimeType,
                url: f.url,
                width: f.width,
              },
            ]
    ),
    playability: payload.playabilityStatus?.status ?? "UNKNOWN",
    reason: payload.playabilityStatus?.reason,
    title: payload.videoDetails?.title,
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
