// dev-sw placeholder — prevents React Router 404 for Vite HMR service worker
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());
