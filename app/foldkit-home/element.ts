// Module: FoldkitHomeElement — the host seam for the home widget.
// A factory over the container so the React route embeds a fresh program per
// mount and disposes it on unmount.

import { Runtime } from "foldkit";

import { Model, init, update, view } from "./main";

export const makeHomeElement = (container: HTMLElement) =>
  Runtime.makeElement({ Model, container, init, update, view });
