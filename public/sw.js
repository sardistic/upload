// Support install promotion on browsers that still require a service worker.
// Navigations always go to the server; uploads, APIs, and media are untouched.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request));
  }
});
