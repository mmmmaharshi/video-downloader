// Route: Home — a thin host for the Foldkit home widget. The widget owns the
// form, the fetch, and the results; React only provides the mount point and
// the runtime lifecycle (embed on setup, dispose on cleanup).
import { Runtime } from "foldkit";
import * as React from "react";

import { makeHomeElement } from "../foldkit-home/element";
import type { Route } from "./+types/home";

export const meta = () => [
  { title: "Video Downloader — Save Online Videos" },
  {
    content: "Paste any public video link to download. No login, no storage.",
    name: "description",
  },
  { content: "https://download.maharshi.work/", property: "og:url" },
  { content: "Video Downloader — Save Online Videos", property: "og:title" },
  {
    content: "Paste any public video link to download. No login, no storage.",
    property: "og:description",
  },
  { content: "website", property: "og:type" },
  { content: "https://download.maharshi.work/og.png", property: "og:image" },
  { content: "summary_large_image", name: "twitter:card" },
  { content: "https://download.maharshi.work/og.png", name: "twitter:image" },
  { content: "Video Downloader — Save Online Videos", name: "twitter:title" },
  {
    content: "Paste any public video link to download. No login, no storage.",
    name: "twitter:description",
  },
];

export const links: Route.LinksFunction = () => [
  { href: "https://download.maharshi.work/", rel: "canonical" },
];

const Home = () => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // dispose restores the container, so the ref stays valid across remounts
  // (including strict mode's setup/cleanup/setup sequence)
  React.useEffect(() => {
    if (containerRef.current === null) {
      return;
    }

    const handle = Runtime.embed(makeHomeElement(containerRef.current));

    return () => {
      handle.dispose();
    };
  }, []);

  return <div ref={containerRef} />;
};

export default Home;
