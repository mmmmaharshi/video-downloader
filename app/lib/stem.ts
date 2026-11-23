// Module: Stem — the one rule for an asset's download name, client-safe.
// The mp4 href and the converted gif are named from the same stem, so the rule
// lives here instead of being rebuilt where each is produced.

export interface StemAsset {
  readonly label?: string;
  readonly platform: string;
  readonly shortcode: string;
}

export const stemOf = (assets: readonly StemAsset[], index = 0): string => {
  const asset = assets[index];

  if (!asset) {
    throw new Error("No video at this position");
  }

  const tag = asset.label ?? String(index + 1);

  return assets.length > 1
    ? `${asset.platform}-${asset.shortcode}-${tag}`
    : `${asset.platform}-${asset.shortcode}`;
};
