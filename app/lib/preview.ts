// Module: Preview — the open/dismiss rule for the preview, as a pure transition.
// Interface: nextPreview(state, event) → PreviewState. The route keeps rendering and the
// effects that apply the rule; the rule itself is drivable in-process through this seam.

import type { VideoAsset } from "./media-resolver";

export type PreviewState = { open: boolean; shown: VideoAsset | null };

export type PreviewEvent =
  | { type: "resolved"; asset: VideoAsset }
  | { type: "failed" }
  | { type: "dismissed" }
  | { type: "backdropClicked" };

export const closedPreview: PreviewState = { open: false, shown: null };

export function nextPreview(state: PreviewState, event: PreviewEvent): PreviewState {
  switch (event.type) {
    case "resolved":
      return { open: true, shown: event.asset };
    case "failed":
    case "dismissed":
      // a no-op transition keeps the same reference, so the route does not re-render
      return state.open ? { ...state, open: false } : state;
    case "backdropClicked":
      return state;
  }
}
