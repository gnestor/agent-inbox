// Minimal service worker for PWA support
// Handles navigation requests by returning the app shell (index.html)
// so client-side routing works in standalone mode on iOS

const CACHE_NAME = "inbox-v1"

self.addEventListener("install", (event) => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
  const { request } = event

  // Only handle navigation requests (HTML page loads)
  // This ensures client-side routing works — all navigation
  // goes through index.html instead of hitting the server
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html"))
    )
  }
})
