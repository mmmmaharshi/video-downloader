// Client entry: the home application owns the page. No framework shell sits
// between the runtime and the document — the view returns the whole Document.

import { Runtime } from "foldkit";

import "../app.css";
import "@fontsource-variable/geist-pixel/elsh.css";

import { Model, init, update, viewDocument } from "../foldkit-home/main";

const root = document.querySelector<HTMLElement>("#root");

if (!root) {
  throw new Error("Missing root element");
}

Runtime.run(
  Runtime.makeApplication({
    Model,
    container: root,
    init,
    update,
    view: viewDocument,
  })
);
