// Module: YouTubeTypes — the vocabulary the YouTube client and its Effect
// program share. Its own file so neither imports the other: the program needs
// these types, and the client needs the program, which would be a cycle.

export interface TubeAsset {
  videoUrl: string;
  height: number;
  title?: string;
}

export type ClientName = "IOS" | "ANDROID";

export interface TubeFormat {
  url?: string;
  mime_type: string;
  width?: number;
  height?: number;
  // true for a progressive stream: video and audio in one file. Adaptive
  // streams carry one track, so offering one as the only option downloads
  // a silent video.
  muxed?: boolean;
}

export interface TubeInfo {
  playability: string;
  reason?: string;
  title?: string;
  formats: TubeFormat[];
}
