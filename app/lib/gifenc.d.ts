declare module "gifenc" {
  export const GIFEncoder: (opts?: { auto?: boolean }) => {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { delay?: number; palette?: number[][] }
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array<ArrayBuffer>;
  };

  export const quantize: (
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number
  ) => number[][];

  export const applyPalette: (
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][]
  ) => Uint8Array;
}
