import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";

import "./app.css";
import "@fontsource-variable/geist-pixel/elsh.css";

export const links: Route.LinksFunction = () => [
  { href: "/favicon.svg?v=2", rel: "icon", type: "image/svg+xml" },
  { href: "/favicon.ico?v=2", rel: "icon", type: "image/x-icon" },
];

export const Layout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en" className="dark" data-theme="dark">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {/* X's CDN answers 403 to any request carrying a Referer, so cross-origin media must go without one */}
      <meta name="referrer" content="same-origin" />
      <Meta />
      <Links />
    </head>
    <body>
      {children}
      <ScrollRestoration />
      <Scripts />
    </body>
  </html>
);

const App = () => {
  // per-component instance: a module singleton would share cached
  // resolutions across server requests
  const queryClient = React.useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    []
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
};

export default App;

export const ErrorBoundary = ({ error }: Route.ErrorBoundaryProps) => {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    const { message: errorMessage, stack: errorStack } = error;
    details = errorMessage;
    stack = errorStack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
};
