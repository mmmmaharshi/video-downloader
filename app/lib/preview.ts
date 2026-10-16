// Module: Preview — the open/dismiss rule for the preview, as a pure transition.
// Interface: nextPreview(state, event) → PreviewState. The route keeps rendering and the
// effects that apply the rule; the rule itself is drivable in-process through this seam.

import type { VideoAsset } from "./media-resolver";

export type PreviewState = { open: boolean; shown: VideoAsset[]; active: number };

export type PreviewEvent =
  | { type: "resolved"; assets: VideoAsset[] }
  | { type: "failed" }
  | { type: "dismissed" }
  | { type: "backdropClicked" }
  | { type: "selected"; index: number };

export const closedPreview: PreviewState = { open: false, shown: [], active: 0 };

export function nextPreview(state: PreviewState, event: PreviewEvent): PreviewState {
  switch (event.type) {
    case "resolved":
      return { open: true, shown: event.assets, active: 0 };
    case "failed":
    case "dismissed":
      // a no-op transition keeps the same reference, so the route does not re-render
      return state.open ? { ...state, open: false } : state;
    case "backdropClicked":
      return state;
    case "selected":
      // only the route's pager sends this, and only with a visible index — anything else is a no-op
      if (event.index < 0 || event.index >= state.shown.length || event.index === state.active) return state;
      return { ...state, active: event.index };
  }
}
