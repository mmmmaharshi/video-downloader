// Production and preview server: Web APIs in, Web Responses out. API routes
// run the framework-free handlers; everything else is the built client with
// an SPA fallback for navigations.

import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleDownload, handleResolve } from "./api";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

const port = Number(process.env.PORT ?? 3000);

// The devtools path is browser noise, not a missing page: answer it before
// the SPA fallback so it never renders the app.
const isDevtoolsProbe = (pathname: string): boolean =>
  pathname === "/.well-known/appspecific/com.chrome.devtools.json";

// A traversal outside dist/ is not a file we serve.
const insideDist = (pathname: string): string | undefined => {
  const file = path.normalize(path.join(DIST, pathname.slice(1)));

  return file.startsWith(DIST) ? file : undefined;
};

const serveFile = async (file: string): Promise<Response | undefined> => {
  let info;

  try {
    info = await stat(file);
  } catch {
    // missing or unreadable: fall through to the SPA fallback or 404
    return undefined;
  }

  if (!info.isFile()) {
    return undefined;
  }

  return new Response(Bun.file(file));
};

const notFound = (): Response => new Response("Not found", { status: 404 });

// One line per API call, errors loud: without an alerting pipeline the server
// log is the only place a production failure surfaces before users report it.
const logApi = (request: Request, res: Response, started: number): void => {
  const ms = Math.round(performance.now() - started);
  const line = `${request.method} ${new URL(request.url).pathname} -> ${res.status} (${ms}ms)`;

  if (res.status >= 500) {
    console.error(line);
  } else {
    console.log(line);
  }
};

Bun.serve({
  fetch: async (request) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/resolve" && request.method === "POST") {
      const started = performance.now();
      const res = await handleResolve(request);

      logApi(request, res, started);

      return res;
    }

    if (url.pathname === "/api/download") {
      const started = performance.now();
      const res = await handleDownload(request);

      logApi(request, res, started);

      return res;
    }

    if (isDevtoolsProbe(url.pathname)) {
      return notFound();
    }

    if (request.method === "GET") {
      const file = insideDist(decodeURIComponent(url.pathname));

      if (file !== undefined) {
        const hit = await serveFile(file);

        if (hit !== undefined) {
          return hit;
        }
      }

      // navigations fall back to the app; anything else is a miss
      const accepts = request.headers.get("accept") ?? "";

      if (accepts.includes("text/html")) {
        return new Response(Bun.file(path.join(DIST, "index.html")));
      }
    }

    return notFound();
  },
  port,
});

console.log(`serving on http://localhost:${port}`);
