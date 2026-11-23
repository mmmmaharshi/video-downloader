// Module: Renditions — one definition for quality ladders, shared by the
// resolvers and the Effect programs. Providers that hand us a ladder become
// one selectable option per rung, best first, so nothing is silently thrown
// away and the caller's next step just gets more links.

// mp4 is the one container every browser plays: prefer those renditions, but
// fall back to whatever the host offers (HLS/DASH manifests, webm) rather than
// dropping the post — one definition so the policy changes in one place
export const preferMp4 = <T>(mp4s: T[], all: T[]): T[] =>
  mp4s.length > 0 ? mp4s : all;

export interface Rendition {
  readonly height?: number;
  /** the provider's own name for this rung when it carries no resolution (Dailymotion's "auto", Facebook's "HD") */
  readonly label?: string;
  readonly url: string;
  readonly width?: number;
}

export const renditionLabel = (r: Rendition): string | undefined =>
  r.height !== undefined && r.height > 0 ? `${r.height}p` : r.label;

// Providers that hand us a quality ladder (YouTube, Vimeo, Streamable,
// Dailymotion, Facebook) become one selectable option per rung, best first —
// the same picker YouTube gets, so nothing is silently thrown away and the
// caller's next step just gets more links. Rungs sharing a label collapse into
// the first, leaving the container preference applied upstream to decide.
export const byQuality = <T extends Rendition>(renditions: T[]): T[] => {
  const seen = new Set<string>();

  const unique = renditions.filter((r) => {
    const label = renditionLabel(r);

    if (label === undefined) {
      return true;
    }

    if (seen.has(label)) {
      return false;
    }

    seen.add(label);

    return true;
  });

  // eslint-disable-next-line unicorn/no-array-sort -- sorts a fresh filtered copy
  return unique.sort(
    (a, b) => (b.height ?? b.width ?? 0) - (a.height ?? a.width ?? 0)
  );
};
