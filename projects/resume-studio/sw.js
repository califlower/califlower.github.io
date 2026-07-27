const CACHE = "resume-studio-calingilan-v4";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./storage.js",
  "./engine.js",
  "./engine-worker.js",
  "./renderer.js",
  "./transfer.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./assets/starter.resume-studio",
  "./python/resume_tool/package.py",
  "./python/resume_tool/browser_api.py",
  "./python/resume_tool/errors.py",
  "./python/resume_tool/history.py",
  "./python/resume_tool/linting.py",
  "./python/resume_tool/models.py",
  "./python/resume_tool/provenance.py",
  "./python/resume_tool/repository.py",
  "./python/resume_tool/resolver.py",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  event.respondWith(url.pathname.endsWith("/config.js") ? networkFirst(event.request) : cacheFirst(event.request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("Network unavailable and response is not cached.");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}
