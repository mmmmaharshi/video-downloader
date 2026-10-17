// Module: Container — the file container a video url (and, on the server, its
// response content-type) actually is, in one definition. The preview's "this
// cannot play" rule and the download's file extension have to agree, so both
// read this instead of keeping a pattern each.
// Client-safe: no imports, no node: builtins.

export type Container = "mov" | "mp4" | "mpd" | "m3u8" | "webm";

// The content-type is authoritative when the host sends a usable one; the path
// is the fallback for hosts that mislabel or omit it.
const SIGNATURES: { container: Container; mime: string; path: RegExp }[] = [
  { container: "m3u8", mime: "mpegurl", path: /\.m3u8(?:[?#]|$)/iu },
  { container: "mpd", mime: "dash+xml", path: /\.mpd(?:[?#]|$)/iu },
  { container: "webm", mime: "webm", path: /\.webm(?:[?#]|$)/iu },
  { container: "mov", mime: "quicktime", path: /\.mov(?:[?#]|$)/iu },
];

export const containerOf = (
  videoUrl: string,
  contentType?: string
): Container => {
  // content-type casing varies in the wild (application/x-mpegURL)
  const mime = contentType?.toLowerCase() ?? "";

  return (
    SIGNATURES.find((s) => mime.includes(s.mime) || s.path.test(videoUrl))
      ?.container ?? "mp4"
  );
};

// a playlist is a manifest, not a file: no <video> element plays one without a
// JS player, and it has no size to show
export const isManifestContainer = (container: Container): boolean =>
  container === "m3u8" || container === "mpd";
