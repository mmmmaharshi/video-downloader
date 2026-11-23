import type { IncomingMessage, ServerResponse } from "node:http";

import { foldkit } from "@foldkit/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import type { Connect } from "vite";
import { defineConfig } from "vite";

import { handleDownload, handleResolve } from "./server/api";

// Development serves /api/* from the same handlers production runs, so the
// client never talks to a second implementation. Node request/response pairs
// cross the boundary as Web Request/Response values and back. Failures run to
// the next middleware, which answers them the way any other dev error renders.
const handleApi = async (
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction
): Promise<void> => {
  if (req.url === undefined || !req.url.startsWith("/api/")) {
    next();

    return;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const request = new Request(`http://localhost${req.url}`, {
    body:
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : Buffer.concat(chunks),
    headers,
    method: req.method,
  });

  let answered: Response | undefined;

  if (req.url.startsWith("/api/resolve") && req.method === "POST") {
    answered = await handleResolve(request);
  } else if (req.url.startsWith("/api/download")) {
    answered = await handleDownload(request);
  }

  if (answered === undefined) {
    next();

    return;
  }

  res.writeHead(
    answered.status,
    Object.fromEntries(answered.headers.entries())
  );
  res.end(Buffer.from(await answered.arrayBuffer()));
};

const api = () => ({
  configureServer: (server: {
    middlewares: { use: (handler: Connect.NextHandleFunction) => void };
  }) => {
    server.middlewares.use((req, res, next) => {
      const run = async (): Promise<void> => {
        try {
          await handleApi(req, res, next);
        } catch {
          return next(new Error("dev API request failed"));
        }
      };

      void run();
    });
  },
  name: "api",
});

export default defineConfig({
  plugins: [tailwindcss(), foldkit(), api()],
  server: {
    port: 5173,
  },
});
