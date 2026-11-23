// Module: OgMeta — page metadata extraction shared by the resolvers and the
// Effect programs. Meta tags and double-escaped JSON carry the video file and
// thumbnail; backslash and HTML-entity escapes are provider noise, stripped
// once here so every caller sees the same url.

export const normalizeUrl = (raw: string): string =>
  raw
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&");

export const extractOgVideo = (html: string): string | undefined => {
  const v =
    html.match(
      /<meta\s+property="og:video:secure_url"\s+content="(?<url>[^"]+)"/u
    )?.groups?.url ??
    html.match(/<meta\s+property="og:video"\s+content="(?<url>[^"]+)"/u)?.groups
      ?.url ??
    html.match(/"video_url"\s*:\s*"(?<url>[^"]+)"/u)?.groups?.url ??
    html.match(/"videoUrl"\s*:\s*"(?<url>[^"]+)"/u)?.groups?.url;

  return v ? normalizeUrl(v) : undefined;
};

export const extractThumbnail = (html: string): string | undefined =>
  html
    .match(/<meta\s+property="og:image"\s+content="(?<url>[^"]+)"/u)
    ?.groups?.url?.replaceAll("&amp;", "&");
